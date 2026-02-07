import React from 'react';

interface SpinnerProps {
  message?: string;
}

const Spinner: React.FC<SpinnerProps> = ({ message = "Writing your prayer..." }) => {
  return (
    <div className="flex flex-col items-center justify-center space-y-6" aria-live="polite" aria-busy="true">
      <div className="relative flex h-20 w-20">
        <div className="absolute inset-0 rounded-full border-2 border-[#C9A050]/20 animate-pulse"></div>
        <div className="absolute inset-2 rounded-full border-t-2 border-[#C9A050] animate-spin"></div>
        <div className="absolute inset-6 rounded-full bg-[#C9A050]/10 flex items-center justify-center">
          <div className="w-2 h-2 rounded-full bg-[#C9A050] animate-ping"></div>
        </div>
      </div>
      <div className="text-center">
        <p className="text-[#C9A050] font-black italic uppercase tracking-[0.2em] text-sm mb-2">{message}</p>
        <p className="text-gray-600 text-[10px] uppercase tracking-widest">This prayer is being written with care.</p>
      </div>
    </div>
  );
};

export default Spinner;
