'use client';

import { useState, useEffect } from 'react';
import { configManager } from '../lib/config-manager.js';
import { glmMonitor } from '../lib/builtin-glm-monitor.js';

export default function BuiltinStatus({ onSwitchToCustom }) {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [usageStats, setUsageStats] = useState(null);

  useEffect(() => {
    const loadStatus = async () => {
      try {
        const [builtinStatus, usage] = await Promise.all([
          configManager.getBuiltinStatus(),
          Promise.resolve(glmMonitor.getUsageStats())
        ]);
        setStatus(builtinStatus);
        setUsageStats(usage);
      } catch (error) {
        setStatus({
          status: 'error',
          error: { message: error.message }
        });
      } finally {
        setLoading(false);
      }
    };

    loadStatus();

    // 每30秒更新一次状态
    const interval = setInterval(loadStatus, 30000);
    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return (
      <div className="flex items-center space-x-2 text-sm text-gray-600">
        <div className="animate-spin w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full"></div>
        <span>检查内置服务状态...</span>
      </div>
    );
  }

  const getStatusColor = (status) => {
    switch (status) {
      case 'ready':
        return 'text-green-600 bg-green-50 border-green-200';
      case 'maintenance':
        return 'text-yellow-600 bg-yellow-50 border-yellow-200';
      case 'disabled':
      case 'error':
        return 'text-red-600 bg-red-50 border-red-200';
      default:
        return 'text-gray-600 bg-gray-50 border-gray-200';
    }
  };

  const getStatusText = (status) => {
    switch (status) {
      case 'ready':
        return '服务正常';
      case 'maintenance':
        return '维护中';
      case 'disabled':
        return '未启用';
      case 'error':
        return '服务异常';
      default:
        return '未知状态';
    }
  };

  const isLimited = usageStats && (
    usageStats.requests > 10 || // 请求超过10次显示警告
    usageStats.violations > 0 // 有违规记录
  );

  return (
    <div className="space-y-3">
      {/* 状态指示器 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <div className={`px-2 py-1 rounded-full text-xs font-medium border ${getStatusColor(status?.status)}`}>
            {getStatusText(status?.status)}
          </div>
          <span className="text-sm text-gray-600">
            GLM-4.6 (内置)
          </span>
        </div>
        {status?.status === 'ready' && (
          <button
            onClick={onSwitchToCustom}
            className="text-sm text-blue-600 hover:text-blue-700 transition-colors"
          >
            切换到自定义
          </button>
        )}
      </div>

      {/* 详细信息 */}
      {status?.status === 'ready' && (
        <div className="space-y-2">
          <p className="text-xs text-gray-600">
            内置的 GLM-4.6 智能助手，无需配置即可使用
          </p>

          {/* 使用量统计 */}
          {usageStats && (
            <div className="bg-gray-50 rounded p-2 space-y-1">
              <div className="flex justify-between text-xs">
                <span className="text-gray-600">本次会话请求:</span>
                <span className={`font-medium ${isLimited ? 'text-yellow-600' : 'text-gray-800'}`}>
                  {usageStats.requests} 次
                </span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-gray-600">Token 消耗:</span>
                <span className="font-medium text-gray-800">
                  {usageStats.tokens}
                </span>
              </div>
              {isLimited && (
                <div className="mt-2 p-2 bg-yellow-50 border border-yellow-200 rounded">
                  <p className="text-xs text-yellow-800">
                    ⚠️ 使用量较高，建议配置自定义 API 获得更好的体验
                  </p>
                </div>
              )}
            </div>
          )}

          {/* 限制说明 */}
          <div className="text-xs text-gray-500">
            <p>• 每小时最多 20 次请求</p>
            <p>• 每小时最多 5000 tokens</p>
            <p>• 适用于体验和轻度使用</p>
          </div>
        </div>
      )}

      {/* 错误状态 */}
      {(status?.status === 'disabled' || status?.status === 'error') && (
        <div className="space-y-2">
          <p className="text-sm text-red-600">
            {status?.error?.message || '内置服务暂时不可用'}
          </p>
          <div className="text-xs text-gray-600">
            <p>请配置自定义 API 以继续使用:</p>
            <ul className="list-disc list-inside mt-1 space-y-1">
              <li>OpenAI API</li>
              <li>Anthropic Claude</li>
              <li>其他 OpenAI 兼容 API</li>
            </ul>
          </div>
          <button
            onClick={onSwitchToCustom}
            className="w-full px-3 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors text-sm"
          >
            配置自定义 API
          </button>
        </div>
      )}

      {/* 维护状态 */}
      {status?.status === 'maintenance' && (
        <div className="space-y-2">
          <p className="text-sm text-yellow-600">
            内置服务正在维护中，请稍后重试
          </p>
          <button
            onClick={onSwitchToCustom}
            className="w-full px-3 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors text-sm"
          >
            临时使用自定义 API
          </button>
        </div>
      )}
    </div>
  );
}