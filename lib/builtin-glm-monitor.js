/**
 * 内置 GLM-4.6 使用量监控和限流模块
 */

class GLMMonitor {
  constructor() {
    this.sessionKey = 'glm-usage-session';
    this.sessionData = this.loadSessionData();
  }

  /**
   * 加载会话使用量数据
   */
  loadSessionData() {
    if (typeof window !== 'undefined') {
      try {
        const data = localStorage.getItem(this.sessionKey);
        if (data) {
          const parsed = JSON.parse(data);
          // 检查是否是新的时间周期（每小时重置）
          const now = new Date();
          const lastReset = new Date(parsed.lastReset);
          if (now.getHours() !== lastReset.getHours() ||
              now.getDate() !== lastReset.getDate()) {
            return this.createFreshSession();
          }
          return parsed;
        }
      } catch (error) {
        console.error('Failed to load usage session:', error);
      }
    }
    return this.createFreshSession();
  }

  /**
   * 创建新的会话数据
   */
  createFreshSession() {
    const session = {
      requests: 0,
      tokens: 0,
      lastReset: new Date().toISOString(),
      lastRequest: null,
      violations: []
    };

    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem(this.sessionKey, JSON.stringify(session));
      } catch (error) {
        console.error('Failed to save usage session:', error);
      }
    }

    return session;
  }

  /**
   * 保存会话数据
   */
  saveSessionData() {
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem(this.sessionKey, JSON.stringify(this.sessionData));
      } catch (error) {
        console.error('Failed to save usage session:', error);
      }
    }
  }

  /**
   * 记录 API 调用
   * @param {number} tokenCount - 使用的 token 数量
   * @returns {Object} 检查结果
   */
  recordUsage(tokenCount = 0) {
    const now = new Date();
    this.sessionData.requests++;
    this.sessionData.tokens += tokenCount;
    this.sessionData.lastRequest = now.toISOString();

    // 检查限制
    const limits = this.getLimits();
    const isWithinLimits = this.checkLimits(limits);

    if (!isWithinLimits.allowed) {
      this.sessionData.violations.push({
        timestamp: now.toISOString(),
        type: isWithinLimits.violation,
        current: isWithinLimits.current,
        limit: isWithinLimits.limit
      });
    }

    this.saveSessionData();
    return {
      ...isWithinLimits,
      usage: {
        requests: this.sessionData.requests,
        tokens: this.sessionData.tokens,
        lastRequest: this.sessionData.lastRequest
      }
    };
  }

  /**
   * 获取当前限制
   */
  getLimits() {
    return {
      requestsPerHour: 20, // 每小时最多20次请求
      tokensPerHour: 5000, // 每小时最多5000个token
      requestsPerDay: 50, // 每天最多50次请求
      cooldownMinutes: 5 // 违规后的冷却时间
    };
  }

  /**
   * 检查是否超出限制
   * @param {Object} limits - 限制配置
   * @returns {Object} 检查结果
   */
  checkLimits(limits) {
    const now = new Date();

    // 检查冷却期
    if (this.sessionData.violations.length > 0) {
      const lastViolation = this.sessionData.violations[this.sessionData.violations.length - 1];
      const violationTime = new Date(lastViolation.timestamp);
      const cooldownEnd = new Date(violationTime.getTime() + limits.cooldownMinutes * 60 * 1000);

      if (now < cooldownEnd) {
        return {
          allowed: false,
          violation: 'COOLDOWN',
          current: 0,
          limit: 0,
          cooldownEnd: cooldownEnd.toISOString()
        };
      }
    }

    // 检查每小时请求限制
    if (this.sessionData.requests >= limits.requestsPerHour) {
      return {
        allowed: false,
        violation: 'HOURLY_REQUESTS',
        current: this.sessionData.requests,
        limit: limits.requestsPerHour
      };
    }

    // 检查每小时 token 限制
    if (this.sessionData.tokens >= limits.tokensPerHour) {
      return {
        allowed: false,
        violation: 'HOURLY_TOKENS',
        current: this.sessionData.tokens,
        limit: limits.tokensPerHour
      };
    }

    // 检查每天请求限制
    const lastReset = new Date(this.sessionData.lastReset);
    if (now.getDate() === lastReset.getDate() &&
        now.getMonth() === lastReset.getMonth() &&
        now.getFullYear() === lastReset.getFullYear() &&
        this.sessionData.requests >= limits.requestsPerDay) {
      return {
        allowed: false,
        violation: 'DAILY_REQUESTS',
        current: this.sessionData.requests,
        limit: limits.requestsPerDay
      };
    }

    return {
      allowed: true,
      violation: null,
      current: null,
      limit: null
    };
  }

  /**
   * 获取当前使用量统计
   */
  getUsageStats() {
    return {
      requests: this.sessionData.requests,
      tokens: this.sessionData.tokens,
      lastReset: this.sessionData.lastReset,
      lastRequest: this.sessionData.lastRequest,
      violations: this.sessionData.violations.length,
      limits: this.getLimits()
    };
  }

  /**
   * 重置使用量数据
   */
  resetUsage() {
    this.sessionData = this.createFreshSession();
  }

  /**
   * 检查是否在冷却期
   */
  isInCooldown() {
    if (this.sessionData.violations.length === 0) {
      return false;
    }

    const lastViolation = this.sessionData.violations[this.sessionData.violations.length - 1];
    const violationTime = new Date(lastViolation.timestamp);
    const limits = this.getLimits();
    const cooldownEnd = new Date(violationTime.getTime() + limits.cooldownMinutes * 60 * 1000);

    return new Date() < cooldownEnd;
  }

  /**
   * 获取用户友好的错误消息
   */
  getErrorMessage() {
    const limits = this.getLimits();
    const check = this.checkLimits(limits);

    if (check.allowed) {
      return null;
    }

    switch (check.violation) {
      case 'HOURLY_REQUESTS':
        return `已达到每小时请求限制 (${check.limit}/${check.limit} 次)。请等待下一小时或配置自定义 API。`;
      case 'HOURLY_TOKENS':
        return `已达到每小时 token 限制。请等待下一小时或配置自定义 API。`;
      case 'DAILY_REQUESTS':
        return `已达到每日请求限制 (${check.limit}/${check.limit} 次)。请等待明天或配置自定义 API。`;
      case 'COOLDOWN':
        return `触发限制，请在冷却时间后重试。`;
      default:
        return 'API 调用受限，请配置自定义 API 或稍后重试。';
    }
  }
}

// 导出单例实例
export const glmMonitor = new GLMMonitor();
export default GLMMonitor;