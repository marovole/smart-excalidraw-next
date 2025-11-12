/**
 * LLM Client for calling OpenAI, Anthropic, and built-in GLM-4.6 APIs
 */

import { glmMonitor } from './builtin-glm-monitor.js';
import { callBuiltinGLM, parseGLMError } from './builtin-glm-client.js';

/**
 * Call LLM API with streaming support
 * @param {Object} config - Provider configuration
 * @param {Array} messages - Chat messages array
 * @param {Function} onChunk - Callback for each chunk
 * @returns {Promise<string>} Complete response
 */
export async function callLLM(config, messages, onChunk) {
  const { type, baseUrl, apiKey, model } = config;

  if (type === 'openai') {
    return callOpenAI(baseUrl, apiKey, model, messages, onChunk);
  } else if (type === 'anthropic') {
    return callAnthropic(baseUrl, apiKey, model, messages, onChunk);
  } else if (type === 'builtin-glm') {
    return callBuiltinGLMAdapter(messages, onChunk);
  } else {
    throw new Error(`Unsupported provider type: ${type}`);
  }
}

/**
 * Call OpenAI-compatible API
 */
async function callOpenAI(baseUrl, apiKey, model, messages, onChunk) {
  const url = `${baseUrl}/chat/completions`;

  // Process messages to support multimodal content (text + images)
  const processedMessages = messages.map(processMessageForOpenAI);

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: processedMessages,
      stream: true,
      max_tokens: 4096,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`OpenAI API error: ${response.status} ${error}`);
  }

  return processOpenAIStream(response.body, onChunk);
}

/**
 * Process OpenAI streaming response
 */
async function processOpenAIStream(body, onChunk) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let fullText = '';
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed === 'data: [DONE]') continue;
        
        if (trimmed.startsWith('data: ')) {
          try {
            const json = JSON.parse(trimmed.slice(6));
            const content = json.choices?.[0]?.delta?.content;
            if (content) {
              fullText += content;
              if (onChunk) onChunk(content);
            }
          } catch (e) {
            console.error('Failed to parse SSE:', e);
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  return fullText;
}

/**
 * Call Anthropic API
 */
async function callAnthropic(baseUrl, apiKey, model, messages, onChunk) {
  const url = `${baseUrl}/messages`;

  // Convert messages format for Anthropic with multimodal support
  const systemMessage = messages.find(m => m.role === 'system');
  const chatMessages = messages.filter(m => m.role !== 'system');
  const processedMessages = chatMessages.map(processMessageForAnthropic);

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
    },
    body: JSON.stringify({
      model,
      messages: processedMessages,
      system: systemMessage ? [{ type: 'text', text: systemMessage.content }] : undefined,
      max_tokens: 4096,
      stream: true,
      temperature: 1,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Anthropic API error: ${response.status} ${error}`);
  }

  return processAnthropicStream(response.body, onChunk);
}

/**
 * Process Anthropic streaming response
 */
async function processAnthropicStream(body, onChunk) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let fullText = '';
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data: ')) continue;
        
        try {
          const json = JSON.parse(trimmed.slice(6));
          
          if (json.type === 'content_block_delta') {
            const content = json.delta?.text;
            if (content) {
              fullText += content;
              if (onChunk) onChunk(content);
            }
          }
        } catch (e) {
          console.error('Failed to parse SSE:', e);
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  return fullText;
}

/**
 * Process message for OpenAI API with multimodal support
 * @param {Object} message - Message object
 * @returns {Object} Processed message for OpenAI
 */
function processMessageForOpenAI(message) {
  // If message doesn't have image data, return as-is
  if (!message.image) {
    return message;
  }

  // Process message with image
  const { image, content } = message;

  return {
    role: message.role,
    content: [
      {
        type: 'text',
        text: content
      },
      {
        type: 'image_url',
        image_url: {
          url: `data:${image.mimeType};base64,${image.data}`,
          detail: 'high'
        }
      }
    ]
  };
}

/**
 * Process message for Anthropic API with multimodal support
 * @param {Object} message - Message object
 * @returns {Object} Processed message for Anthropic
 */
function processMessageForAnthropic(message) {
  // If message doesn't have image data, return as-is
  if (!message.image) {
    return message;
  }

  // Process message with image
  const { image, content } = message;

  return {
    role: message.role === 'assistant' ? 'assistant' : 'user',
    content: [
      {
        type: 'text',
        text: content
      },
      {
        type: 'image',
        source: {
          type: 'base64',
          media_type: image.mimeType,
          data: image.data
        }
      }
    ]
  };
}

/**
 * Test configuration connection with a simple API call
 * @param {Object} config - Provider configuration
 * @returns {Promise<Object>} Test result with success status and message
 */
export async function testConnection(config) {
  const { type, baseUrl, apiKey } = config;

  if (type === 'builtin-glm') {
    return testBuiltinGLMConnection();
  }

  try {
    // Try to fetch models as a simple connection test
    const models = await fetchModels(type, baseUrl, apiKey);

    if (models && models.length > 0) {
      return {
        success: true,
        message: `连接成功，找到 ${models.length} 个可用模型`,
        models: models.slice(0, 5) // Return first 5 models for preview
      };
    } else {
      return {
        success: false,
        message: '连接成功但未找到可用模型'
      };
    }
  } catch (error) {
    return {
      success: false,
      message: `连接失败: ${error.message}`
    };
  }
}

/**
 * Test built-in GLM connection
 * @returns {Promise<Object>} Test result
 */
async function testBuiltinGLMConnection() {
  try {
    // Call the meta API to check status
    const response = await fetch('/api/builtin-llm-meta');

    if (!response.ok) {
      return {
        success: false,
        message: '内置 GLM 服务不可用'
      };
    }

    const meta = await response.json();

    if (meta.status === 'ready') {
      return {
        success: true,
        message: '内置 GLM-4.6 连接正常',
        models: [{
          id: meta.model,
          name: 'GLM-4.6 (内置)',
          description: meta.meta?.description || '内置的 GLM-4.6 智能助手'
        }]
      };
    } else if (meta.status === 'maintenance') {
      return {
        success: false,
        message: '内置 GLM 服务维护中'
      };
    } else {
      return {
        success: false,
        message: meta.error?.message || '内置 GLM 未配置'
      };
    }
  } catch (error) {
    return {
      success: false,
      message: `连接测试失败: ${error.message}`
    };
  }
}

/**
 * Fetch available models from provider
 * @param {string} type - Provider type
 * @param {string} baseUrl - API base URL
 * @param {string} apiKey - API key
 * @returns {Promise<Array>} List of available models
 */
export async function fetchModels(type, baseUrl, apiKey) {
  if (type === 'openai') {
    const url = `${baseUrl}/models`;
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch models: ${response.status}`);
    }

    const data = await response.json();
    return (Array.isArray(data?.data) ? data.data : Array.isArray(data?.models) ? data.models : Array.isArray(data) ? data : [])
      .map(model => ({
        id: typeof model === 'string' ? model : (model.id || model.name || model.model || model.slug),
        name: typeof model === 'string' ? model : (model.name || model.id || model.model || model.slug),
      }))
      .filter(m => m.id);
  } else if (type === 'anthropic') {
    // Request actual models from provider like OpenAI, but with Anthropic headers
    const url = `${baseUrl}/models`;
    const response = await fetch(url, {
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch models: ${response.status}`);
    }

    const data = await response.json();
    return (Array.isArray(data?.data) ? data.data : Array.isArray(data?.models) ? data.models : Array.isArray(data) ? data : [])
      .map(model => ({
        id: typeof model === 'string' ? model : (model.id || model.name || model.model || model.slug),
        name: typeof model === 'string' ? model : (model.name || model.id || model.model || model.slug),
      }))
      .filter(m => m.id);
  } else if (type === 'builtin-glm') {
    // For built-in GLM, return a predefined model
    return [{
      id: process.env.BUILTIN_GLM_MODEL || 'glm-4.6',
      name: 'GLM-4.6 (内置)',
      description: '内置的 GLM-4.6 智能助手'
    }];
  } else {
    throw new Error(`Unsupported provider type: ${type}`);
  }
}

/**
 * Call built-in GLM API with monitoring and usage tracking
 * @param {Array} messages - Chat messages array
 * @param {Function} onChunk - Callback for each chunk
 * @returns {Promise<string>} Complete response
 */
async function callBuiltinGLMAdapter(messages, onChunk) {
  try {
    // Check usage limits first
    const usageCheck = glmMonitor.recordUsage();
    if (!usageCheck.allowed) {
      throw new Error(usageCheck.violation);
    }

    // Convert messages to a single prompt for GLM
    const prompt = messagesToPrompt(messages);

    // Call the built-in GLM API
    const stream = await callBuiltinGLM(prompt);

    return processGLMStream(stream, onChunk, usageCheck);

  } catch (error) {
    // Parse GLM specific errors
    const parsedError = parseGLMError(error);

    // If it's a rate limit or configuration error, update monitor
    if (parsedError.type === 'RATE_LIMIT_EXCEEDED' || parsedError.type === 'AUTHENTICATION_ERROR') {
      // You could add more sophisticated error tracking here
    }

    throw new Error(`内置 GLM 错误: ${parsedError.message}`);
  }
}

/**
 * Convert message array to a single prompt string
 * @param {Array} messages - Chat messages
 * @returns {string} Combined prompt
 */
function messagesToPrompt(messages) {
  // Handle system message separately
  const systemMessage = messages.find(m => m.role === 'system');
  const chatMessages = messages.filter(m => m.role !== 'system');

  let prompt = '';

  // Add system context if present
  if (systemMessage) {
    prompt += `系统说明: ${systemMessage.content}\n\n`;
  }

  // Add conversation history
  for (const message of chatMessages) {
    const role = message.role === 'user' ? '用户' : '助手';
    prompt += `${role}: ${message.content}\n\n`;
  }

  // Add current request prompt
  prompt += '助手: ';

  return prompt;
}

/**
 * Process GLM streaming response
 * @param {ReadableStream} stream - GLM response stream
 * @param {Function} onChunk - Callback for each chunk
 * @param {Object} usageCheck - Usage check result
 * @returns {Promise<string>} Complete response
 */
async function processGLMStream(stream, onChunk, usageCheck) {
  const reader = stream.getReader();
  let fullText = '';

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      const chunk = value;

      if (chunk.type === 'content' && chunk.content) {
        fullText += chunk.content;
        if (onChunk) {
          onChunk(chunk.content);
        }
      } else if (chunk.type === 'usage' && chunk.usage) {
        // Update usage tracking with actual token usage
        const tokensUsed = chunk.usage.total_tokens || 0;
        glmMonitor.recordUsage(tokensUsed);
      } else if (chunk.type === 'error') {
        throw new Error(chunk.error?.message || 'GLM streaming error');
      }
    }
  } finally {
    reader.releaseLock();
  }

  return fullText;
}

