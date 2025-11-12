'use client';

import { useState, useEffect } from 'react';
import dynamic from 'next/dynamic';
import Chat from '@/components/Chat';
import CodeEditor from '@/components/CodeEditor';
import ConfigManager from '@/components/ConfigManager';
import ContactModal from '@/components/ContactModal';
import Notification from '@/components/Notification';
import { getConfig, isConfigValid } from '@/lib/config';
import { optimizeExcalidrawCode } from '@/lib/optimizeArrows';
import { configManager } from '@/lib/config-manager.js';

// Dynamically import ExcalidrawCanvas to avoid SSR issues
const ExcalidrawCanvas = dynamic(() => import('@/components/ExcalidrawCanvas'), {
  ssr: false,
});

export default function Home() {
  const [config, setConfig] = useState(null);
  const [isConfigManagerOpen, setIsConfigManagerOpen] = useState(false);
  const [isContactModalOpen, setIsContactModalOpen] = useState(false);
  const [generatedCode, setGeneratedCode] = useState('');
  const [elements, setElements] = useState([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isApplyingCode, setIsApplyingCode] = useState(false);
  const [isOptimizingCode, setIsOptimizingCode] = useState(false);
  const [leftPanelWidth, setLeftPanelWidth] = useState(25); // Percentage of viewport width
  const [isResizingHorizontal, setIsResizingHorizontal] = useState(false);
  const [apiError, setApiError] = useState(null);
  const [jsonError, setJsonError] = useState(null);
  const [notification, setNotification] = useState({
    isOpen: false,
    title: '',
    message: '',
    type: 'info'
  });

  // Load config on mount and listen for config changes
  useEffect(() => {
    const initializeConfig = async () => {
      // Load configurations
      configManager.loadConfigs();

      // Try to get user config first
      const savedConfig = configManager.getActiveConfig();

      if (savedConfig) {
        setConfig(savedConfig);
      } else {
        // Try to set builtin GLM as fallback
        try {
          const builtinStatus = await configManager.getBuiltinStatus();
          if (builtinStatus.status === 'ready') {
            await configManager.setBuiltinActive();
            const builtinConfig = configManager.getActiveConfig();
            setConfig(builtinConfig);
          }
        } catch (error) {
          console.log('Builtin GLM not available:', error.message);
          // No config available, user will need to configure manually
        }
      }
    };

    initializeConfig();

    // Listen for storage changes to sync across tabs
    const handleStorageChange = (e) => {
      if (e.key === 'smart-excalidraw-active-config' ||
          e.key === 'smart-excalidraw-configs' ||
          e.key === 'smart-excalidraw-builtin-active') {
        configManager.loadConfigs(); // Reload from storage
        const newConfig = configManager.getActiveConfig();
        setConfig(newConfig);
      }
    };

    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, []);

  // Post-process Excalidraw code: remove markdown wrappers and fix unescaped quotes
  const postProcessExcalidrawCode = (code) => {
    if (!code || typeof code !== 'string') return code;

    let processed = code.trim();
    console.log('Original code:', processed.substring(0, 200) + (processed.length > 200 ? '...' : ''));

    // Step 1: Remove markdown code fence wrappers (```json, ```javascript, ```js, or just ```)
    processed = processed.replace(/^```(?:json|javascript|js)?\s*\n?/i, '');
    processed = processed.replace(/\n?```\s*$/, '');
    processed = processed.trim();

    // Step 2: Try to extract JSON content from mixed text
    // Look for JSON objects or arrays in the text
    let jsonContent = processed;

    // 首先尝试使用平衡括号提取（更可靠）
    const balancedSnippet = extractBalancedJsonSnippet(processed);

    if (balancedSnippet) {
      jsonContent = balancedSnippet;
      console.log('Extracted balanced JSON snippet from generated text');
    } else if (!processed.startsWith('{') && !processed.startsWith('[')) {
      // 如果平衡提取失败，回退到简单的正则匹配
      // Look for JSON object
      const objectMatch = processed.match(/\{[\s\S]*\}/);
      if (objectMatch) {
        jsonContent = objectMatch[0];
        console.log('Found JSON object in mixed content');
      } else {
        // Look for JSON array
        const arrayMatch = processed.match(/\[[\s\S]*\]/);
        if (arrayMatch) {
          jsonContent = arrayMatch[0];
          console.log('Found JSON array in mixed content');
        }
      }
    }

    // Step 3: Try to parse the extracted content as-is first
    try {
      const parsed = JSON.parse(jsonContent);
      console.log('Successfully parsed JSON content directly');
      return jsonContent; // Already valid JSON, no need to fix
    } catch (e) {
      console.log('Direct parse failed, attempting to fix quotes:', e.message);
    }

    // Step 4: If direct parse failed, try to fix unescaped quotes
    try {
      const fixed = fixUnescapedQuotes(jsonContent);
      // Test if the fix worked
      JSON.parse(fixed);
      console.log('Successfully fixed and parsed JSON content');
      return fixed;
    } catch (e) {
      console.log('Failed to fix JSON content:', e.message);
      // Return original content so user can see what was generated
      return processed;
    }
  };

  // Helper function to fix unescaped quotes in JSON strings
  const fixUnescapedQuotes = (jsonString) => {
    let result = '';
    let inString = false;
    let escapeNext = false;
    let currentQuotePos = -1;

    for (let i = 0; i < jsonString.length; i++) {
      const char = jsonString[i];
      const prevChar = i > 0 ? jsonString[i - 1] : '';

      if (escapeNext) {
        result += char;
        escapeNext = false;
        continue;
      }

      if (char === '\\') {
        result += char;
        escapeNext = true;
        continue;
      }

      if (char === '"') {
        if (!inString) {
          // Starting a string
          inString = true;
          currentQuotePos = i;
          result += char;
        } else {
          // Potentially ending a string
          // Check if this is a structural quote (followed by : or , or } or ])
          const nextNonWhitespace = jsonString.slice(i + 1).match(/^\s*(.)/);
          const nextChar = nextNonWhitespace ? nextNonWhitespace[1] : '';

          if (nextChar === ':' || nextChar === ',' || nextChar === '}' || nextChar === ']' || nextChar === '') {
            // This is a closing quote for the string
            inString = false;
            result += char;
          } else {
            // This is an unescaped quote within the string - escape it
            result += '\\"';
          }
        }
      } else {
        result += char;
      }
    }

    return result;
  };

  // 括号映射：用于自动补全
  const closingBracketMap = { '{': '}', '[': ']' };

  /**
   * 从文本中提取平衡的 JSON 片段（使用栈追踪括号匹配）
   * 这个函数比简单的正则更可靠，可以正确处理嵌套结构
   */
  const extractBalancedJsonSnippet = (text) => {
    const stack = [];
    let startIndex = -1;
    let inString = false;
    let escapeNext = false;

    for (let i = 0; i < text.length; i++) {
      const char = text[i];

      // 处理转义字符
      if (escapeNext) {
        escapeNext = false;
        continue;
      }

      if (char === '\\') {
        escapeNext = true;
        continue;
      }

      // 处理字符串内容（字符串内的括号不计数）
      if (char === '"') {
        inString = !inString;
        continue;
      }

      if (inString) {
        continue;
      }

      // 遇到开括号时入栈
      if (char === '{' || char === '[') {
        if (stack.length === 0) {
          startIndex = i;
        }
        stack.push(char);
      }
      // 遇到闭括号时出栈
      else if (char === '}' || char === ']') {
        const lastOpen = stack[stack.length - 1];
        const matches =
          (lastOpen === '{' && char === '}') ||
          (lastOpen === '[' && char === ']');

        if (matches) {
          stack.pop();
          // 栈空了说明找到了完整的平衡片段
          if (stack.length === 0 && startIndex !== -1) {
            return text.slice(startIndex, i + 1);
          }
        } else if (stack.length > 0) {
          // 括号不匹配，重置状态
          stack.length = 0;
          startIndex = -1;
        }
      }
    }

    return null;
  };

  /**
   * 分析 JSON 结构，检测括号平衡性和缺失的括号
   * 返回诊断信息帮助用户理解问题
   */
  const analyzeJsonStructure = (text) => {
    const stack = [];
    let inString = false;
    let escapeNext = false;
    let hasMismatchedClosing = false;

    for (let i = 0; i < text.length; i++) {
      const char = text[i];

      if (escapeNext) {
        escapeNext = false;
        continue;
      }

      if (char === '\\') {
        escapeNext = true;
        continue;
      }

      if (char === '"') {
        inString = !inString;
        continue;
      }

      if (inString) {
        continue;
      }

      if (char === '{' || char === '[') {
        stack.push(char);
      } else if (char === '}' || char === ']') {
        const lastOpen = stack[stack.length - 1];
        const matches =
          (lastOpen === '{' && char === '}') ||
          (lastOpen === '[' && char === ']');

        if (matches) {
          stack.pop();
        } else {
          hasMismatchedClosing = true;
        }
      }
    }

    // 根据栈中剩余的开括号，生成需要补全的闭括号
    const pendingClosers = stack
      .slice()
      .reverse()
      .map((open) => closingBracketMap[open] || '')
      .join('');

    return {
      isBalanced: stack.length === 0 && !hasMismatchedClosing,
      pendingClosers,
      pendingCount: stack.length,
      hasMismatchedClosing,
    };
  };

  /**
   * 统一检查解析后的数据，提取 elements 数组
   * 支持多种常见的数据结构
   */
  const inspectParsedElements = (parsed) => {
    // 直接是数组
    if (Array.isArray(parsed)) {
      return { elements: parsed, source: 'array' };
    }

    // 对象结构
    if (parsed && typeof parsed === 'object') {
      if (Array.isArray(parsed.elements)) {
        return { elements: parsed.elements, source: 'parsed.elements' };
      }
      if (Array.isArray(parsed.data) && Array.isArray(parsed.data[0]?.elements)) {
        return {
          elements: parsed.data[0].elements,
          source: 'parsed.data[0].elements',
        };
      }
      if (Array.isArray(parsed.data?.elements)) {
        return { elements: parsed.data.elements, source: 'parsed.data.elements' };
      }
    }

    return null;
  };

  // Handle sending a message (single-turn)
  const handleSendMessage = async (userMessage, chartType = 'auto') => {
    if (!isConfigValid(config)) {
      setNotification({
        isOpen: true,
        title: '配置提醒',
        message: '请先配置您的 LLM 提供商',
        type: 'warning'
      });
      setIsConfigManagerOpen(true);
      return;
    }

    setIsGenerating(true);
    setApiError(null); // Clear previous errors
    setJsonError(null); // Clear previous JSON errors

    try {
      // Call generate API with streaming
      const response = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          config,
          userInput: userMessage,
          chartType,
        }),
      });

      if (!response.ok) {
        // Parse error response body if available
        let errorMessage = '生成代码失败';
        try {
          const errorData = await response.json();
          if (errorData.error) {
            errorMessage = errorData.error;
          }
        } catch (e) {
          // If response body is not JSON, use status-based messages
          switch (response.status) {
            case 400:
              errorMessage = '请求参数错误，请检查输入内容';
              break;
            case 401:
            case 403:
              errorMessage = 'API 密钥无效或权限不足，请检查配置';
              break;
            case 429:
              errorMessage = '请求过于频繁，请稍后再试';
              break;
            case 500:
            case 502:
            case 503:
              errorMessage = '服务器错误，请稍后重试';
              break;
            default:
              errorMessage = `请求失败 (${response.status})`;
          }
        }
        throw new Error(errorMessage);
      }

      // Process streaming response
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let accumulatedCode = '';
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.trim() === '' || line.trim() === 'data: [DONE]') continue;

          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              if (data.content) {
                accumulatedCode += data.content;
                // Post-process and set the cleaned code to editor
                const processedCode = postProcessExcalidrawCode(accumulatedCode);
                setGeneratedCode(processedCode);
              } else if (data.error) {
                throw new Error(data.error);
              }
            } catch (e) {
              // SSE parsing errors - show to user
              if (e.message && !e.message.includes('Unexpected')) {
                setApiError('数据流解析错误：' + e.message);
              }
              console.error('Failed to parse SSE:', e);
            }
          }
        }
      }

      // Try to parse and apply the generated code (already post-processed)
      const processedCode = postProcessExcalidrawCode(accumulatedCode);
      tryParseAndApply(processedCode);

      // Automatically optimize the generated code
      const optimizedCode = optimizeExcalidrawCode(processedCode);
      setGeneratedCode(optimizedCode);
      tryParseAndApply(optimizedCode);
    } catch (error) {
      console.error('Error generating code:', error);
      // Check if it's a network error
      if (error.message === 'Failed to fetch' || error.name === 'TypeError') {
        setApiError('网络连接失败，请检查网络连接');
      } else {
        setApiError(error.message);
      }
    } finally {
      setIsGenerating(false);
    }
  };

  // Try to parse and apply code to canvas
  const tryParseAndApply = (code) => {
    try {
      // Clear previous JSON errors
      setJsonError(null);

      // Code is already post-processed, just extract the array and parse
      const cleanedCode = code.trim();
      console.log('Parsing code:', cleanedCode.substring(0, 200) + (cleanedCode.length > 200 ? '...' : ''));

      let elementsArray = null;
      const structureAnalysis = analyzeJsonStructure(cleanedCode);
      const parseDiagnostics = [];

      // Try to parse as JSON directly first
      try {
        const parsed = JSON.parse(cleanedCode);
        const parsedInfo = inspectParsedElements(parsed);

        if (parsedInfo) {
          elementsArray = parsedInfo.elements;
          console.log('Successfully parsed via', parsedInfo.source, 'with', elementsArray.length, 'elements');
        } else {
          console.log('Object found but no elements array detected:',
            parsed && typeof parsed === 'object' ? Object.keys(parsed) : parsed);
        }
      } catch (directParseError) {
        parseDiagnostics.push(`直接解析失败：${directParseError.message}`);
        console.log('Direct JSON parse failed, trying regex extraction:', directParseError.message);
      }

      // If direct parsing failed, try regex extraction as fallback
      if (!elementsArray) {
        const arrayMatch = cleanedCode.match(/\[[\s\S]*\]/);
        if (arrayMatch) {
          try {
            const parsed = JSON.parse(arrayMatch[0]);
            const parsedInfo = inspectParsedElements(parsed);

            if (parsedInfo) {
              elementsArray = parsedInfo.elements;
              console.log('Successfully parsed using regex extraction with', elementsArray.length, 'elements');
            } else {
              parseDiagnostics.push('正则提取后的 JSON 中没有可用的元素数组');
            }
          } catch (regexError) {
            parseDiagnostics.push(`正则提取后的 JSON 解析失败：${regexError.message}`);
            console.log('Regex extraction also failed:', regexError.message);
          }
        } else {
          parseDiagnostics.push('未能匹配到 JSON 数组片段');
        }
      }

      // Attempt to auto-complete missing closing brackets
      if (!elementsArray && structureAnalysis.pendingClosers) {
        const completionSnippet = cleanedCode + structureAnalysis.pendingClosers;
        try {
          const parsed = JSON.parse(completionSnippet);
          const parsedInfo = inspectParsedElements(parsed);

          if (parsedInfo) {
            elementsArray = parsedInfo.elements;
            console.log('Auto-completed missing closing brackets and parsed', elementsArray.length, 'elements');
            parseDiagnostics.push(`自动补全了缺失的 ${structureAnalysis.pendingClosers}`);
          }
        } catch (completionError) {
          parseDiagnostics.push(`补全闭括号后仍解析失败：${completionError.message}`);
        }
      }

      // If we found elements, apply them
      if (elementsArray && Array.isArray(elementsArray)) {
        setElements(elementsArray);
        setJsonError(null);
        console.log('Successfully applied', elementsArray.length, 'elements to canvas');
        return;
      }

      // Build detailed error message
      const baseErrorMsg = '代码中未找到有效的 JSON 数组或元素对象';
      const hints = [];

      if (structureAnalysis.pendingCount > 0) {
        hints.push(`似乎缺少 ${structureAnalysis.pendingClosers || '闭括号'}`);
      }
      if (structureAnalysis.hasMismatchedClosing) {
        hints.push('存在括号不匹配');
      }

      const hintMsg = hints.join('，');
      const detailMsg = parseDiagnostics.length
        ? parseDiagnostics.join('；')
        : '请确认生成的内容为完整的 JSON 数据';

      const preview = cleanedCode
        .substring(0, 200)
        .replace(/\s+/g, ' ')
        .trim();

      const finalErrorMsg = `${baseErrorMsg}${hintMsg ? `（${hintMsg}）` : ''}。${detailMsg}。代码片段：${preview || '空'}`;

      setJsonError(finalErrorMsg);
      console.error(finalErrorMsg);
      console.error('Original code length:', code.length);
      console.error('Cleaned code preview:', cleanedCode.substring(0, 500));

    } catch (error) {
      console.error('Unexpected error in tryParseAndApply:', error);
      // Extract native JSON error message
      if (error instanceof SyntaxError) {
        setJsonError('JSON 语法错误：' + error.message);
      } else {
        setJsonError('解析失败：' + error.message);
      }
    }
  };

  // Handle applying code from editor
  const handleApplyCode = async () => {
    setIsApplyingCode(true);
    try {
      // Simulate async operation for better UX
      await new Promise(resolve => setTimeout(resolve, 300));
      tryParseAndApply(generatedCode);
    } catch (error) {
      console.error('Error applying code:', error);
    } finally {
      setIsApplyingCode(false);
    }
  };

  // Handle optimizing code
  const handleOptimizeCode = async () => {
    setIsOptimizingCode(true);
    try {
      // Simulate async operation for better UX
      await new Promise(resolve => setTimeout(resolve, 500));
      const optimizedCode = optimizeExcalidrawCode(generatedCode);
      setGeneratedCode(optimizedCode);
      tryParseAndApply(optimizedCode);
    } catch (error) {
      console.error('Error optimizing code:', error);
    } finally {
      setIsOptimizingCode(false);
    }
  };

  // Handle clearing code
  const handleClearCode = () => {
    setGeneratedCode('');
  };

  // Handle config selection from manager
  const handleConfigSelect = (selectedConfig) => {
    if (selectedConfig) {
      setConfig(selectedConfig);
    }
  };

  // Handle horizontal resizing (left panel vs right panel)
  const handleHorizontalMouseDown = (e) => {
    setIsResizingHorizontal(true);
    e.preventDefault();
  };

  useEffect(() => {
    const handleMouseMove = (e) => {
      if (!isResizingHorizontal) return;
      
      const percentage = (e.clientX / window.innerWidth) * 100;
      
      // 可调节的范围
      setLeftPanelWidth(Math.min(Math.max(percentage, 20), 80));
    };

    const handleMouseUp = () => {
      setIsResizingHorizontal(false);
    };

    if (isResizingHorizontal) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizingHorizontal]);

  return (
    <div className="flex flex-col h-screen bg-gray-50">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 bg-white border-b border-gray-200">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">Smart Excalidraw</h1>
          <p className="text-xs text-gray-500">AI 驱动的图表生成</p>
        </div>
        <div className="flex items-center space-x-3">
          {config && isConfigValid(config) && (
            <div className={`flex items-center space-x-2 px-3 py-1.5 rounded border ${
              config.isBuiltin
                ? 'bg-blue-50 border-blue-300'
                : 'bg-green-50 border-green-300'
            }`}>
              <div className={`w-2 h-2 rounded-full ${
                config.isBuiltin ? 'bg-blue-500' : 'bg-green-500'
              }`}></div>
              <span className={`text-xs font-medium ${
                config.isBuiltin ? 'text-blue-900' : 'text-green-900'
              }`}>
                {config.name || config.type} - {config.model || '内置模型'}
              </span>
            </div>
          )}
          <div className="flex items-center space-x-2">
            <button
              onClick={() => setIsConfigManagerOpen(true)}
              className="px-4 py-2 text-sm font-medium text-white bg-gray-900 border border-gray-900 rounded hover:bg-gray-800 transition-colors duration-200"
            >
              管理配置
            </button>
          </div>
        </div>
      </header>

      {/* Main Content - Two Column Layout */}
      <div className="flex flex-1 overflow-hidden pb-1">
        {/* Left Panel - Chat and Code Editor */}
        <div id="left-panel" style={{ width: `${leftPanelWidth}%` }} className="flex flex-col border-r border-gray-200 bg-white">
          {/* API Error Banner */}
          {apiError && (
            <div className="bg-red-50 border-b border-red-200 px-4 py-3 flex items-start justify-between">
              <div className="flex items-start space-x-2">
                <svg className="w-5 h-5 text-red-600 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                </svg>
                <div>
                  <p className="text-sm font-medium text-red-800">请求失败</p>
                  <p className="text-sm text-red-700 mt-1">{apiError}</p>
                </div>
              </div>
              <button
                onClick={() => setApiError(null)}
                className="text-red-600 hover:text-red-800 transition-colors"
              >
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                </svg>
              </button>
            </div>
          )}

          {/* Input Section */}
          <div style={{ height: '50%' }} className="overflow-auto">
            <Chat
              onSendMessage={handleSendMessage}
              isGenerating={isGenerating}
            />
          </div>

          {/* Code Editor Section */}
          <div style={{ height: '50%' }} className="overflow-hidden">
            <CodeEditor
              code={generatedCode}
              onChange={setGeneratedCode}
              onApply={handleApplyCode}
              onOptimize={handleOptimizeCode}
              onClear={handleClearCode}
              jsonError={jsonError}
              onClearJsonError={() => setJsonError(null)}
              isGenerating={isGenerating}
              isApplyingCode={isApplyingCode}
              isOptimizingCode={isOptimizingCode}
            />
          </div>
        </div>

        {/* Horizontal Resizer */}
        <div
          onMouseDown={handleHorizontalMouseDown}
          className="w-1 bg-gray-200 hover:bg-gray-400 cursor-col-resize transition-colors duration-200 flex-shrink-0"
        />

        {/* Right Panel - Excalidraw Canvas */}
        <div style={{ width: `${100 - leftPanelWidth}%` }} className="bg-gray-50">
          <ExcalidrawCanvas elements={elements} />
        </div>
      </div>

      {/* Config Manager Modal */}
      <ConfigManager
        isOpen={isConfigManagerOpen}
        onClose={() => setIsConfigManagerOpen(false)}
        onConfigSelect={handleConfigSelect}
      />

      {/* Footer */}
      <footer className="bg-white border-t border-gray-200 px-6 py-3">
        <div className="flex items-center justify-center space-x-4 text-sm text-gray-600">
          <span>Smart Excalidraw v0.1.0</span>
          <span className="text-gray-400">|</span>
          <span>AI 驱动的智能图表生成工具</span>
          <span className="text-gray-400">|</span>
          <a
            href="https://github.com/liujuntao123/smart-excalidraw-next"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center space-x-1 hover:text-gray-900 transition-colors"
          >
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
              <path fillRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" clipRule="evenodd" />
            </svg>
            <span>GitHub</span>
          </a>
          <span className="text-gray-400">|</span>
          <button
            onClick={() => setIsContactModalOpen(true)}
            className="flex items-center space-x-1 hover:text-gray-900 transition-colors text-blue-600 hover:text-blue-700"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
            <span>联系作者</span>
          </button>
        </div>
      </footer>

      {/* Contact Modal */}
      <ContactModal
        isOpen={isContactModalOpen}
        onClose={() => setIsContactModalOpen(false)}
      />

      {/* Notification */}
      <Notification
        isOpen={notification.isOpen}
        onClose={() => setNotification({ ...notification, isOpen: false })}
        title={notification.title}
        message={notification.message}
        type={notification.type}
      />
    </div>
  );
}
