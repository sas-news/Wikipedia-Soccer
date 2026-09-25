import { ArrowLeft } from 'lucide-react';

export default function BackButton({
  onClick,
  label = '設定画面に戻る',
}: {
  onClick: () => void;
  label?: string;
}) {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-bold text-gray-500 hover:text-gray-800 hover:bg-gray-100 rounded-lg transition-colors"
    >
      <ArrowLeft className="w-4 h-4" />
      {label}
    </button>
  );
}
