
import React from 'react';
import { SUPPORTED_LANGUAGES, Language } from '../types';

interface Props {
  label: string;
  selectedCode: string;
  onSelect: (code: string) => void;
  disabled?: boolean;
}

const LanguageSelector: React.FC<Props> = ({ label, selectedCode, onSelect, disabled }) => {
  return (
    <div className="flex flex-col gap-2">
      <label className="text-sm font-medium text-slate-400 uppercase tracking-wider">{label}</label>
      <select
        disabled={disabled}
        value={selectedCode}
        onChange={(e) => onSelect(e.target.value)}
        className="bg-white/10 border border-white/20 text-white rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {SUPPORTED_LANGUAGES.map((lang) => (
          <option key={lang.code} value={lang.code} className="bg-slate-900 text-white">
            {lang.name} ({lang.nativeName})
          </option>
        ))}
      </select>
    </div>
  );
};

export default LanguageSelector;
