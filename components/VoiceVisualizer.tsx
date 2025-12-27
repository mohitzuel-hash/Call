
import React, { useEffect, useRef } from 'react';

interface Props {
  isActive: boolean;
}

const VoiceVisualizer: React.FC<Props> = ({ isActive }) => {
  const bars = Array.from({ length: 12 });

  return (
    <div className="flex items-center justify-center gap-1.5 h-16">
      {bars.map((_, i) => (
        <div
          key={i}
          className={`w-1.5 bg-indigo-500 rounded-full transition-all duration-300 ${
            isActive ? 'animate-bounce' : 'h-2'
          }`}
          style={{
            animationDelay: `${i * 0.1}s`,
            height: isActive ? `${Math.random() * 40 + 10}px` : '8px'
          }}
        />
      ))}
    </div>
  );
};

export default VoiceVisualizer;
