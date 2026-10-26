import React, { useEffect, useRef } from 'react';

function getCanvasPoint(canvas, event) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
  };
}

function getThemeColors() {
  const styles = getComputedStyle(document.documentElement);
  return {
    bg: styles.getPropertyValue('--color-surface').trim() || '#ffffff',
    fg: styles.getPropertyValue('--color-text').trim() || '#0f172a',
  };
}

export function SignaturePad({ value, onChange, height = 110 }) {
  const canvasRef = useRef(null);
  const drawingRef = useRef(false);
  const lastPointRef = useRef(null);

  const valueRef = useRef(value);
  const imageVersionRef = useRef(0);

  useEffect(() => {
    valueRef.current = value;
    const canvas = canvasRef.current;
    if (!canvas || drawingRef.current) return;
    const version = ++imageVersionRef.current;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = getThemeColors().bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (value) {
      const img = new Image();
      img.onload = () => {
        if (version === imageVersionRef.current && !drawingRef.current) {
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        }
      };
      img.src = value;
    }
  }, [value]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const dpr = window.devicePixelRatio || 1;
      const width = Math.round(rect.width * dpr);
      const pixelHeight = Math.round(rect.height * dpr);
      if (canvas.width === width && canvas.height === pixelHeight) return;
      // Copy pixels synchronously, including strokes not yet committed by pointerup.
      const copy = document.createElement('canvas');
      copy.width = canvas.width;
      copy.height = canvas.height;
      copy.getContext('2d').drawImage(canvas, 0, 0);
      canvas.width = width;
      canvas.height = pixelHeight;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = getThemeColors().bg;
      ctx.fillRect(0, 0, width, pixelHeight);
      ctx.drawImage(copy, 0, 0, width, pixelHeight);
      lastPointRef.current = null;
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    window.addEventListener('resize', resize);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', resize);
    };
  }, [height]);

  const paintTo = (point, drawLine) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const colors = getThemeColors();
    const scaleX = canvas.width / canvas.getBoundingClientRect().width;
    const scaleY = canvas.height / canvas.getBoundingClientRect().height;
    ctx.lineWidth = 2 * (window.devicePixelRatio || 1);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = colors.fg;
    if (drawLine && lastPointRef.current) {
      ctx.beginPath();
      ctx.moveTo(lastPointRef.current.x * scaleX, lastPointRef.current.y * scaleY);
      ctx.lineTo(point.x * scaleX, point.y * scaleY);
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.arc(point.x * scaleX, point.y * scaleY, 1.5 * (window.devicePixelRatio || 1), 0, Math.PI * 2);
      ctx.fillStyle = colors.fg;
      ctx.fill();
    }
    lastPointRef.current = point;
  };

  const handlePointerDown = (event) => {
    event.preventDefault();
    ++imageVersionRef.current;
    canvasRef.current?.setPointerCapture?.(event.pointerId);
    drawingRef.current = true;
    lastPointRef.current = null;
    paintTo(getCanvasPoint(canvasRef.current, event), false);
  };

  const handlePointerMove = (event) => {
    if (!drawingRef.current) return;
    event.preventDefault();
    paintTo(getCanvasPoint(canvasRef.current, event), true);
  };

  const endDraw = (event) => {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    lastPointRef.current = null;
    canvasRef.current?.releasePointerCapture?.(event.pointerId);
    valueRef.current = canvasRef.current.toDataURL('image/png');
    onChange?.(valueRef.current);
  };

  const handleClear = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    ++imageVersionRef.current;
    valueRef.current = null;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = getThemeColors().bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    onChange?.(null);
  };

  return (
    <div className="signature-pad">
      <canvas
        ref={canvasRef}
        className="signature-pad__canvas"
        style={{ height: `${height}px`, width: '100%', touchAction: 'none', display: 'block' }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endDraw}
        onPointerCancel={endDraw}
        onLostPointerCapture={endDraw}
      />
      <button type="button" className="signature-pad__clear" onClick={handleClear} aria-label="clear">
        ✕
      </button>
    </div>
  );
}

export default SignaturePad;
