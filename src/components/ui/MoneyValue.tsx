import React, { useLayoutEffect, useRef, useState } from 'react';

interface MoneyValueProps {
  amount: number;
  className?: string;
  prefix?: '+' | '-';
  maximumFractionDigits?: number;
  fit?: boolean;
}

export const formatMoney = (amount: number, maximumFractionDigits = 2) => {
  const value = Number.isFinite(amount) ? amount : 0;
  return `$${value.toLocaleString('en-US', { maximumFractionDigits })}`;
};

/** Keeps currency values readable and correctly ordered inside RTL layouts. */
export const MoneyValue: React.FC<MoneyValueProps> = ({
  amount,
  className = '',
  prefix,
  maximumFractionDigits = 2,
  fit = true,
}) => {
  const valueRef = useRef<HTMLElement>(null);
  const [fontSize, setFontSize] = useState<number>();

  useLayoutEffect(() => {
    if (!fit || !valueRef.current) return;

    const value = valueRef.current;
    const container = value.parentElement;
    if (!container) return;

    const fitToContainer = () => {
      // Measure at the size from the utility classes before applying a scale.
      value.style.fontSize = '';
      const baseFontSize = Number.parseFloat(window.getComputedStyle(value).fontSize);
      const containerStyle = window.getComputedStyle(container);
      // clientWidth includes horizontal padding, while a normal-flow child is
      // laid out in the content box. Use the latter so fitting starts before
      // the value touches a card's visible edge.
      const availableWidth = container.clientWidth
        - Number.parseFloat(containerStyle.paddingInlineStart || containerStyle.paddingLeft || '0')
        - Number.parseFloat(containerStyle.paddingInlineEnd || containerStyle.paddingRight || '0');
      const naturalWidth = value.getBoundingClientRect().width;

      if (!baseFontSize || !availableWidth || naturalWidth <= availableWidth) {
        setFontSize(undefined);
        return;
      }

      // Keep the full number visible. 12px is a readable lower bound for a KPI.
      const fittedSize = Math.max(12, Math.floor(baseFontSize * ((availableWidth - 2) / naturalWidth)));
      value.style.fontSize = `${fittedSize}px`;
      setFontSize(fittedSize);
    };

    fitToContainer();
    const observer = new ResizeObserver(fitToContainer);
    observer.observe(container);
    return () => observer.disconnect();
  }, [amount, className, fit, maximumFractionDigits, prefix]);

  return (
    <bdi ref={valueRef} dir="ltr" className={`money-value ${className}`} style={fontSize ? { fontSize: `${fontSize}px` } : undefined}>
      {prefix}{formatMoney(amount, maximumFractionDigits)}
    </bdi>
  );
};
