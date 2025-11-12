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

    // 验证 API 连接（可选，用于健康检查）
    // 这里可以添加实际的健康检查逻辑
    const healthCheck = await performHealthCheck(baseUrl, apiKey);

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
 * 执行 GLM API 健康检查
 * @param {string} baseUrl - API 基础 URL
 * @param {string} apiKey - API 密钥
 * @returns {Promise<{success: boolean, error?: string}>}
 */
async function performHealthCheck(baseUrl, apiKey) {
  try {
    // 简单的连接测试 - 可以根据 GLM API 规范调整
    const response = await fetch(`${baseUrl}/v1/models`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      signal: AbortSignal.timeout(5000) // 5秒超时
    });

    if (response.ok) {
      return { success: true };
    } else {
      return {
        success: false,
        error: `HTTP ${response.status}: ${response.statusText}`
      };
    }
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
}