'use client';

import dynamic from 'next/dynamic';
import { useState, useEffect, useMemo, useRef } from 'react';
import '@excalidraw/excalidraw/index.css';

// Dynamically import Excalidraw with no SSR
const Excalidraw = dynamic(
  async () => (await import('@excalidraw/excalidraw')).Excalidraw,
  { ssr: false }
);

// Dynamically import convertToExcalidrawElements
const getConvertFunction = async () => {
  const excalidrawModule = await import('@excalidraw/excalidraw');
  return excalidrawModule.convertToExcalidrawElements;
};

/**
 * 为元素数组生成唯一的签名，用于检测内容变化
 * 使用元素的关键属性（id、type、位置）来生成稳定的标识
 */
const createElementsSignature = (elements) => {
  if (!elements || !Array.isArray(elements) || elements.length === 0) {
    return '';
  }

  return elements
    .map((el) => {
      const id = el.id || '';
      const type = el.type || '';
      const x = Math.round(el.x ?? 0);
      const y = Math.round(el.y ?? 0);
      return `${id}:${type}:${x}:${y}`;
    })
    .join('|');
};

export default function ExcalidrawCanvas({ elements }) {
  const [convertToExcalidrawElements, setConvertFunction] = useState(null);
  const [excalidrawAPI, setExcalidrawAPI] = useState(null);

  // 使用 ref 保存最后一次成功转换的元素，避免转换失败时清空画布
  const lastValidElementsRef = useRef([]);
  // 使用 ref 保存最后一次滚动的签名，避免重复触发滚动
  const lastScrollSignatureRef = useRef('');

  // Load convert function on mount
  useEffect(() => {
    getConvertFunction().then(fn => {
      setConvertFunction(() => fn);
    });
  }, []);

  // Convert elements to Excalidraw format
  const convertedElements = useMemo(() => {
    // 如果输入的元素为空，清空上次的状态并返回空数组
    if (!elements || elements.length === 0) {
      lastValidElementsRef.current = [];
      lastScrollSignatureRef.current = '';
      return [];
    }

    // 如果转换函数还未加载，返回上次的有效元素（避免闪烁）
    if (!convertToExcalidrawElements) {
      return lastValidElementsRef.current;
    }

    try {
      const converted = convertToExcalidrawElements(elements);

      // 验证转换结果是否有效
      if (Array.isArray(converted) && converted.length > 0) {
        lastValidElementsRef.current = converted;
        return converted;
      }

      // 转换结果为空，保留上次的有效内容（避免闪烁）
      console.warn('Element conversion returned empty array, keeping last valid content');
      return lastValidElementsRef.current;
    } catch (error) {
      console.error('Failed to convert elements:', error);
      // 转换失败时，保留上次的有效元素
      return lastValidElementsRef.current;
    }
  }, [elements, convertToExcalidrawElements]);

  // Auto zoom to fit content when API is ready and elements change
  useEffect(() => {
    // API 未就绪或没有内容时不执行滚动
    if (!excalidrawAPI || convertedElements.length === 0) {
      lastScrollSignatureRef.current = '';
      return;
    }

    // 生成当前内容的签名
    const currentSignature = createElementsSignature(convertedElements);

    // 签名为空或与上次相同时不重复滚动
    if (!currentSignature || currentSignature === lastScrollSignatureRef.current) {
      return;
    }

    // 更新签名并执行滚动
    lastScrollSignatureRef.current = currentSignature;

    // 延迟执行以确保元素已经渲染
    const timeout = setTimeout(() => {
      excalidrawAPI.scrollToContent(convertedElements, {
        fitToContent: true,
        animate: true,
        duration: 300,
      });
    }, 100);

    // 清理函数：组件卸载或依赖变化时清除定时器
    return () => clearTimeout(timeout);
  }, [excalidrawAPI, convertedElements]);

  // Generate unique key when elements change to force remount
  const canvasKey = useMemo(() => {
    if (convertedElements.length === 0) {
      return 'empty';
    }

    // 使用完整的元素签名而不是截断的 JSON
    // 这样可以确保相同内容产生相同的 key，避免不必要的重新挂载
    const signature = createElementsSignature(convertedElements);
    return signature ? `canvas-${signature.slice(0, 100)}-${convertedElements.length}` : 'content';
  }, [convertedElements]);

  return (
    <div className="w-full h-full">
      <Excalidraw
        key={canvasKey}
        excalidrawAPI={(api) => setExcalidrawAPI(api)}
        initialData={{
          elements: convertedElements,
          appState: {
            viewBackgroundColor: '#ffffff',
            currentItemFontFamily: 1,
          },
          scrollToContent: true,
        }}
      />
    </div>
  );
}

