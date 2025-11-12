/**
 * 内置 GLM-4.6 API 客户端封装
 * 处理 GLM 特有的 API 格式和 SSE 流
 */

/**
 * 调用内置 GLM-4.6 API
 * @param {string} prompt - 用户输入的提示
 * @param {Object} options - 调用选项
 * @returns {Promise<ReadableStream>} SSE 流
 */
export async function callBuiltinGLM(prompt, options = {}) {
  const baseUrl = process.env.BUILTIN_GLM_BASE_URL;
  const apiKey = process.env.BUILTIN_GLM_API_KEY;
  const model = process.env.BUILTIN_GLM_MODEL || 'glm-4.6';

  if (!baseUrl || !apiKey) {
    throw new Error('内置 GLM-4.6 API 未配置');
  }

  // 构建 GLM API 请求
  const requestBody = {
    model,
    messages: [
      {
        role: 'user',
        content: prompt
      }
    ],
    stream: true, // 启用流式响应
    temperature: options.temperature || 0.7,
    max_tokens: options.maxTokens || 2000,
    top_p: options.topP || 0.9,
    ...options.additionalParams
  };

  try {
    const response = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Accept': 'text/event-stream',
        'Cache-Control': 'no-cache'
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`GLM API Error ${response.status}: ${errorText}`);
    }

    return createGLMStream(response);

  } catch (error) {
    console.error('GLM API call failed:', error);
    throw error;
  }
}

/**
 * 创建 GLM SSE 流处理器
 * @param {Response} response - Fetch API 响应
 * @returns {ReadableStream} 处理后的流
 */
function createGLMStream(response) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();

  return new ReadableStream({
    async start(controller) {
      try {
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();

          if (done) {
            controller.close();
            break;
          }

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.slice(6);

              if (data === '[DONE]') {
                controller.close();
                return;
              }

              try {
                const parsed = JSON.parse(data);
                const processed = processGLMChunk(parsed);

                if (processed) {
                  controller.enqueue(processed);
                }
              } catch (error) {
                console.warn('Failed to parse GLM SSE data:', data, error);
              }
            } else if (line.startsWith('error: ')) {
              const errorData = line.slice(7);
              try {
                const error = JSON.parse(errorData);
                controller.error(new Error(`GLM Error: ${error.message || errorData}`));
              } catch {
                controller.error(new Error(`GLM Error: ${errorData}`));
              }
              return;
            }
          }
        }
      } catch (error) {
        console.error('GLM Stream error:', error);
        controller.error(error);
      } finally {
        reader.releaseLock();
      }
    },

    cancel() {
      reader.cancel();
    }
  });
}

/**
 * 处理 GLM API 响应块
 * @param {Object} chunk - GLM API 返回的数据块
 * @returns {Object|null} 处理后的数据
 */
function processGLMChunk(chunk) {
  // GLM API 格式适配
  if (chunk.choices && chunk.choices.length > 0) {
    const choice = chunk.choices[0];

    if (choice.delta?.content) {
      return {
        type: 'content',
        content: choice.delta.content,
        finished: choice.finish_reason !== null
      };
    }

    if (choice.finish_reason) {
      return {
        type: 'finish',
        reason: choice.finish_reason,
        finished: true
      };
    }
  }

  // 处理 GLM 特有的错误或状态信息
  if (chunk.error) {
    return {
      type: 'error',
      error: chunk.error
    };
  }

  // 处理使用量信息
  if (chunk.usage) {
    return {
      type: 'usage',
      usage: chunk.usage
    };
  }

  return null;
}

/**
 * 验证 GLM API 配置
 * @returns {Promise<boolean>} 配置是否有效
 */
export async function validateGLMConfig() {
  try {
    const baseUrl = process.env.BUILTIN_GLM_BASE_URL;
    const apiKey = process.env.BUILTIN_GLM_API_KEY;

    if (!baseUrl || !apiKey) {
      return false;
    }

    // 简单的健康检查
    const response = await fetch(`${baseUrl}/v1/models`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      signal: AbortSignal.timeout(5000)
    });

    return response.ok;
  } catch (error) {
    console.warn('GLM config validation failed:', error);
    return false;
  }
}

/**
 * 获取 GLM API 状态信息
 * @returns {Promise<Object>} API 状态
 */
export async function getGLMStatus() {
  try {
    const isValid = await validateGLMConfig();

    return {
      available: isValid,
      provider: 'glm-4.6',
      model: process.env.BUILTIN_GLM_MODEL || 'glm-4.6',
      lastChecked: new Date().toISOString(),
      error: isValid ? null : '配置无效或服务不可用'
    };
  } catch (error) {
    return {
      available: false,
      provider: 'glm-4.6',
      error: error.message,
      lastChecked: new Date().toISOString()
    };
  }
}

/**
 * GLM 错误类型映射
 */
export const GLM_ERROR_TYPES = {
  INVALID_REQUEST: 'INVALID_REQUEST',
  AUTHENTICATION_ERROR: 'AUTHENTICATION_ERROR',
  PERMISSION_DENIED: 'PERMISSION_DENIED',
  NOT_FOUND: 'NOT_FOUND',
  RATE_LIMIT_EXCEEDED: 'RATE_LIMIT_EXCEEDED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  NETWORK_ERROR: 'NETWORK_ERROR'
};

/**
 * 解析 GLM API 错误
 * @param {Error|string} error - 错误信息
 * @returns {Object} 结构化错误信息
 */
export function parseGLMError(error) {
  const errorMessage = typeof error === 'string' ? error : error.message;

  // 根据错误消息判断错误类型
  if (errorMessage.includes('401') || errorMessage.includes('unauthorized')) {
    return {
      type: GLM_ERROR_TYPES.AUTHENTICATION_ERROR,
      message: 'API 密钥无效',
      original: errorMessage
    };
  }

  if (errorMessage.includes('403') || errorMessage.includes('forbidden')) {
    return {
      type: GLM_ERROR_TYPES.PERMISSION_DENIED,
      message: 'API 权限不足',
      original: errorMessage
    };
  }

  if (errorMessage.includes('429') || errorMessage.includes('rate limit')) {
    return {
      type: GLM_ERROR_TYPES.RATE_LIMIT_EXCEEDED,
      message: 'API 调用频率超限',
      original: errorMessage
    };
  }

  if (errorMessage.includes('404') || errorMessage.includes('not found')) {
    return {
      type: GLM_ERROR_TYPES.NOT_FOUND,
      message: 'API 端点不存在',
      original: errorMessage
    };
  }

  if (errorMessage.includes('400') || errorMessage.includes('bad request')) {
    return {
      type: GLM_ERROR_TYPES.INVALID_REQUEST,
      message: '请求格式错误',
      original: errorMessage
    };
  }

  if (errorMessage.includes('fetch') || errorMessage.includes('network')) {
    return {
      type: GLM_ERROR_TYPES.NETWORK_ERROR,
      message: '网络连接错误',
      original: errorMessage
    };
  }

  return {
    type: GLM_ERROR_TYPES.INTERNAL_ERROR,
    message: '服务器内部错误',
    original: errorMessage
  };
}