/**
 * GLM-4.6 内置 API 元数据接口
 * 返回内置 LLM 服务的状态、配置和限流信息
 */

export async function GET() {
  try {
    // 检查环境变量是否配置
    const baseUrl = process.env.BUILTIN_GLM_BASE_URL;
    const apiKey = process.env.BUILTIN_GLM_API_KEY;
    const model = process.env.BUILTIN_GLM_MODEL || 'glm-4.6';

    const isConfigured = !!(baseUrl && apiKey);

    // 基础响应结构
    const response = {
      provider: 'glm-4.6',
      status: isConfigured ? 'ready' : 'disabled',
      model,
      lastChecked: new Date().toISOString(),
      rateLimit: {
        requestsPerMinute: 60, // 默认限制
        tokensPerMinute: 30000,
        currentUsage: {
          requests: 0,
          tokens: 0
        }
      },
      meta: {
        version: '1.0.0',
        description: '内置 GLM-4.6 智能助手',
        features: ['text-generation', 'streaming']
      }
    };

    // 如果未配置，返回简化的响应
    if (!isConfigured) {
      return Response.json({
        ...response,
        status: 'disabled',
        error: {
          code: 'NOT_CONFIGURED',
          message: '内置 GLM-4.6 API 未配置'
        }
      }, {
        status: 200,
        headers: {
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Content-Type': 'application/json'
        }
      });
    }

    // 验证 API 连接（使用 /chat/completions 端点）
    const healthCheck = await performHealthCheck(baseUrl, apiKey, model);

    if (!healthCheck.success) {
      return Response.json({
        ...response,
        status: 'maintenance',
        error: {
          code: 'HEALTH_CHECK_FAILED',
          message: 'API 健康检查失败',
          details: healthCheck.error
        }
      }, {
        status: 503,
        headers: {
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Content-Type': 'application/json'
        }
      });
    }

    return Response.json(response, {
      status: 200,
      headers: {
        'Cache-Control': 'public, max-age=30', // 30秒缓存
        'Content-Type': 'application/json'
      }
    });

  } catch (error) {
    console.error('GLM Meta API Error:', error);

    return Response.json({
      provider: 'glm-4.6',
      status: 'error',
      error: {
        code: 'INTERNAL_ERROR',
        message: '服务器内部错误'
      },
      lastChecked: new Date().toISOString()
    }, {
      status: 500,
      headers: {
        'Cache-Control': 'no-cache',
        'Content-Type': 'application/json'
      }
    });
  }
}

/**
 * 执行 GLM API 健康检查（使用 /chat/completions 端点）
 * @param {string} baseUrl - API 基础 URL
 * @param {string} apiKey - API 密钥
 * @param {string} model - 模型名称
 * @returns {Promise<{success: boolean, error?: object}>}
 */
async function performHealthCheck(baseUrl, apiKey, model) {
  const url = `${baseUrl}/chat/completions`;
  const controller = new AbortController();
  const timeoutMs = 8000; // 增加超时时间到8秒
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    // 发送一个最小的测试请求来验证 API 可用性
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: model,
        messages: [
          {
            role: 'user',
            content: 'ping'
          }
        ],
        max_tokens: 5, // 最小token数
        temperature: 0
      }),
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    if (response.ok) {
      console.log('GLM health check passed', {
        url,
        status: response.status,
        model: model
      });
      return { success: true };
    }

    // 尝试解析错误响应体
    let errorBody = null;
    try {
      errorBody = await response.json();
    } catch {
      // 如果不是 JSON，忽略
    }

    const invalidResponse = {
      type: 'InvalidResponseError',
      code: 'INVALID_RESPONSE',
      url,
      message: `Unexpected status ${response.status} (${response.statusText})`,
      status: response.status,
      responseBody: errorBody
    };
    console.error('GLM health check invalid response', invalidResponse);
    return { success: false, error: invalidResponse };
  } catch (error) {
    clearTimeout(timeoutId);
    const normalized = normalizeHealthCheckError(error, url, timeoutMs);
    console.error('GLM health check failed', normalized);
    return { success: false, error: normalized };
  }

  /**
   * 标准化健康检查错误信息
   * @param {Error} error - 原始错误对象
   * @param {string} url - 请求URL
   * @param {number} timeoutMs - 超时毫秒数
   * @returns {object} 标准化错误对象
   */
  function normalizeHealthCheckError(error, url, timeoutMs) {
    const type = error?.name || 'Error';
    const code = error?.code || (type === 'AbortError' ? 'TIMEOUT' : 'UNKNOWN_ERROR');

    let userMessage = '无法连接到 GLM API。';
    switch (code) {
      case 'ENOTFOUND':
      case 'EAI_AGAIN':
        userMessage = '无法解析 GLM API 主机名（DNS 问题）。';
        break;
      case 'ETIMEDOUT':
      case 'TIMEOUT':
      case 'ECONNABORTED':
        userMessage = `请求超时（超过 ${timeoutMs / 1000}s）。`;
        break;
      case 'DEPTH_ZERO_SELF_SIGNED_CERT':
      case 'ERR_TLS_CERT_ALTNAME_INVALID':
      case 'ERR_CERT_COMMON_NAME_INVALID':
        userMessage = 'SSL/TLS 证书校验失败。';
        break;
      case 'ENETUNREACH':
      case 'EHOSTUNREACH':
      case 'ECONNREFUSED':
      case 'ECONNRESET':
        userMessage = '网络连接失败，无法访问 GLM API。';
        break;
      default:
        if (type === 'AbortError') {
          userMessage = `请求被取消（可能是超时 ${timeoutMs / 1000}s）。`;
        }
    }

    return {
      type,
      code,
      url,
      message: userMessage,
      details: error?.message,
      stack: error?.stack
    };
  }
}