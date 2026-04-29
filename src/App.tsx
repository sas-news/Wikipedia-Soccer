import React, { useState, useEffect, useRef } from 'react';
import { Search, Play, RotateCcw, ArrowRight, Trophy, AlertCircle, Eye, EyeOff, Save, Trash2, Dices } from 'lucide-react';

type Phase = 'settings' | 'history' | 'setup_p1' | 'setup_p2' | 'confirm' | 'playing' | 'won';

type HistoryEntry = { title: string; player: 1 | 2 };

export interface PastGameRecord {
  id: string;
  date: string;
  winner: 1 | 2;
  p1Target: string;
  p2Target: string;
  history: HistoryEntry[];
  startPage: string;
}

interface SavedGame {
  phase: Phase;
  startPageMode: 'random' | 'custom';
  customStartPage: string;
  movesPhase1: number;
  movesPhaseN: number;
  turnTimeLimit: number;
  p1Target: string;
  p2Target: string;
  currentPlayer: 1 | 2;
  turnCount: number;
  movesMade: number;
  currentPage: string;
  turnHistory: string[];
  globalHistory: HistoryEntry[];
  timeLeft: number;
}
const SAVE_KEY = 'wiki_soccer_save';

export default function App() {
  const [phase, setPhase] = useState<Phase>('settings');
  
  // Game Settings State
  const [startPageMode, setStartPageMode] = useState<'random' | 'custom'>('random');
  const [customStartPage, setCustomStartPage] = useState('');
  const [movesPhase1, setMovesPhase1] = useState(1);
  const [movesPhaseN, setMovesPhaseN] = useState(2);
  const [turnTimeLimit, setTurnTimeLimit] = useState<number>(0); // 0 = unlimited
  
  // Setup
  const [p1Target, setP1Target] = useState('');
  const [p2Target, setP2Target] = useState('');
  const [isStarting, setIsStarting] = useState(false);

  // Game State
  const [currentPlayer, setCurrentPlayer] = useState<1 | 2>(1);
  const [turnCount, setTurnCount] = useState(1);
  const [movesMade, setMovesMade] = useState(0);
  const [currentPage, setCurrentPage] = useState('');
  const [turnHistory, setTurnHistory] = useState<string[]>([]);
  const [globalHistory, setGlobalHistory] = useState<HistoryEntry[]>([]);
  const [winner, setWinner] = useState<1 | 2 | null>(null);
  const [timeLeft, setTimeLeft] = useState<number>(0);
  
  // UI State
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [showTarget, setShowTarget] = useState(false);
  const [hasSaveData, setHasSaveData] = useState(false);
  const [hasReachedConfirm, setHasReachedConfirm] = useState(false);

  useEffect(() => {
    setHasSaveData(!!localStorage.getItem(SAVE_KEY));
  }, [phase]);

  const maxMoves = turnCount === 1 ? movesPhase1 : movesPhaseN;
  const currentTarget = currentPlayer === 1 ? p1Target : p2Target;

  const showToast = (message: string) => {
    setToastMessage(message);
    setTimeout(() => setToastMessage(null), 4000);
  };

  const handleNextSetup = () => {
    if (!p1Target) {
      showToast('目標ページを設定してください');
      return;
    }
    setPhase(hasReachedConfirm ? 'confirm' : 'setup_p2');
  };

  const fetchRandomTarget = async (setTarget: (target: string) => void) => {
    try {
      const res = await fetch('/api/random');
      const data = await res.json();
      setTarget(data.title);
    } catch (e) {
      showToast('ランダム記事の取得に失敗しました');
    }
  };

  const startGame = async () => {
    if (!p2Target) {
      showToast('目標ページを設定してください');
      return;
    }
    
    setIsStarting(true);
    try {
      let startPage = '';
      if (startPageMode === 'custom' && customStartPage) {
        startPage = customStartPage;
      } else {
        const res = await fetch('/api/random');
        const data = await res.json();
        startPage = data.title;
      }
      
      setCurrentPage(startPage);
      setGlobalHistory([{ title: startPage, player: 1 }]);
      setTurnHistory([startPage]);
      setCurrentPlayer(1);
      setTurnCount(1);
      setMovesMade(0);
      setWinner(null);
      setTimeLeft(turnTimeLimit);
      setPhase('playing');
    } catch (e) {
      showToast('ランダム記事の取得に失敗しました');
    } finally {
      setIsStarting(false);
    }
  };

  const handleLinkClick = (rawTitle: string) => {
    if (phase !== 'playing') return;

    let decodedTitle = '';
    try {
      decodedTitle = decodeURIComponent(rawTitle).replace(/_/g, ' ');
    } catch(e) {
      decodedTitle = rawTitle.replace(/_/g, ' ');
    }
    
    // Win condition check - ALWAYS allows navigation if it's the target page!
    if (decodedTitle === currentTarget) {
      setCurrentPage(decodedTitle);
      
      const finalHistory: HistoryEntry[] = [...globalHistory, { title: decodedTitle, player: currentPlayer }];
      setGlobalHistory(finalHistory);
      setWinner(currentPlayer);
      setPhase('won');
      localStorage.removeItem(SAVE_KEY);
      setHasSaveData(false);
      
      // Save past record
      const record: PastGameRecord = {
        id: Date.now().toString(),
        date: new Date().toLocaleString(),
        winner: currentPlayer,
        p1Target,
        p2Target,
        history: finalHistory,
        startPage: globalHistory[0].title
      };
      const pastRecords = JSON.parse(localStorage.getItem('wiki_soccer_past_records') || '[]');
      localStorage.setItem('wiki_soccer_past_records', JSON.stringify([record, ...pastRecords].slice(0, 50)));
      
      return;
    }
    
    // Normal limit check (if not winning)
    if (movesMade >= maxMoves) {
      showToast(`「${decodedTitle}」は目標のページではありません！`);
      return;
    }

    // Normal move
    setCurrentPage(decodedTitle);
    setMovesMade(m => m + 1);
    setGlobalHistory(h => [...h, { title: decodedTitle, player: currentPlayer }]);
    setTurnHistory(h => [...h, decodedTitle]);
  };

  useEffect(() => {
    const handleMessage = (e: MessageEvent) => {
      if (e.data && e.data.type === 'WIKI_LINK_CLICK') {
        handleLinkClick(e.data.title);
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [movesMade, maxMoves, currentTarget, currentPlayer, phase]);

  const handleEndTurn = () => {
    setCurrentPlayer(currentPlayer === 1 ? 2 : 1);
    setTurnCount(c => c + 1);
    setMovesMade(0);
    setTurnHistory([currentPage]);
    setTimeLeft(turnTimeLimit);
  };

  useEffect(() => {
    if (phase !== 'playing' || turnTimeLimit === 0) return;
    
    if (timeLeft <= 0) {
      handleEndTurn();
      return;
    }
    
    const timerId = setTimeout(() => {
      setTimeLeft(t => t - 1);
    }, 1000);
    
    return () => clearTimeout(timerId);
  }, [timeLeft, phase, turnTimeLimit, currentPage, currentPlayer]);

  const handleUndo = () => {
    if (turnHistory.length > 1) {
      const newHistory = [...turnHistory];
      newHistory.pop(); // remove current
      const previousPage = newHistory[newHistory.length - 1];
      
      setCurrentPage(previousPage);
      setTurnHistory(newHistory);
      setMovesMade(m => m - 1);
      
      const newGlobal = [...globalHistory];
      newGlobal.pop();
      setGlobalHistory(newGlobal);
    }
  };

  const handleSaveAndQuit = () => {
    const stateToSave: SavedGame = {
      phase: 'playing',
      startPageMode,
      customStartPage,
      movesPhase1,
      movesPhaseN,
      turnTimeLimit,
      p1Target,
      p2Target,
      currentPlayer,
      turnCount,
      movesMade,
      currentPage,
      turnHistory,
      globalHistory,
      timeLeft
    };
    localStorage.setItem(SAVE_KEY, JSON.stringify(stateToSave));
    setHasSaveData(true);
    setPhase('settings');
    showToast('ゲームを保存して中断しました');
  };

  const loadGame = () => {
    const saved = localStorage.getItem(SAVE_KEY);
    if (saved) {
      try {
        const state: SavedGame = JSON.parse(saved);
        setStartPageMode(state.startPageMode);
        setCustomStartPage(state.customStartPage);
        setMovesPhase1(state.movesPhase1);
        setMovesPhaseN(state.movesPhaseN);
        setTurnTimeLimit(state.turnTimeLimit);
        setP1Target(state.p1Target);
        setP2Target(state.p2Target);
        setCurrentPlayer(state.currentPlayer);
        setTurnCount(state.turnCount);
        setMovesMade(state.movesMade);
        setCurrentPage(state.currentPage);
        setTurnHistory(state.turnHistory);
        setGlobalHistory((state.globalHistory || []).map(entry => typeof entry === 'string' ? { title: entry, player: 1 } : entry));
        setTimeLeft(state.timeLeft);
        setPhase(state.phase);
      } catch(e) {
        showToast('セーブデータの読み込みに失敗しました');
      }
    }
  };

  const clearSave = () => {
    localStorage.removeItem(SAVE_KEY);
    setHasSaveData(false);
  };

  // Setup View Array
  if (phase === 'settings') {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-2xl shadow-xl">
          <div className="p-6 text-white text-center bg-gray-900 rounded-t-2xl">
            <h1 className="text-3xl font-bold mb-2">Wikipedia Soccer</h1>
            <p className="text-white/90">ゲーム設定</p>
          </div>
          
          <div className="p-6 space-y-6">
            <div className="space-y-3">
              <label className="block text-sm font-bold text-gray-700">スタートページ</label>
              <div className="flex gap-2">
                <button
                  onClick={() => setStartPageMode('random')}
                  className={`flex-1 py-2 px-3 text-sm font-bold rounded-lg border ${startPageMode === 'random' ? 'bg-gray-900 border-gray-900 text-white' : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'}`}
                >
                  ランダム
                </button>
                <button
                  onClick={() => setStartPageMode('custom')}
                  className={`flex-1 py-2 px-3 text-sm font-bold rounded-lg border ${startPageMode === 'custom' ? 'bg-gray-900 border-gray-900 text-white' : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'}`}
                >
                  指定する
                </button>
              </div>
              {startPageMode === 'custom' && (
                <div className="mt-2 text-sm font-medium">
                  <WikiAutocomplete 
                    value={customStartPage} 
                    onChange={setCustomStartPage} 
                    placeholder="例: Wikipedia または リンクをペースト" 
                  />
                </div>
              )}
            </div>

            <div className="space-y-3">
              <label className="block text-sm font-bold text-gray-700">1ターンの移動可能回数</label>
              <div className="flex gap-4">
                <div className="flex-1">
                  <span className="text-xs text-gray-500 mb-1 block">1ターン目</span>
                  <input type="number" min="1" max="10" value={movesPhase1} onChange={e => setMovesPhase1(Number(e.target.value) || 1)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-medium focus:outline-none focus:ring-2 focus:ring-gray-900"/>
                </div>
                <div className="flex-1">
                  <span className="text-xs text-gray-500 mb-1 block">2ターン目以降</span>
                  <input type="number" min="1" max="10" value={movesPhaseN} onChange={e => setMovesPhaseN(Number(e.target.value) || 2)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-medium focus:outline-none focus:ring-2 focus:ring-gray-900"/>
                </div>
              </div>
            </div>

            <div className="space-y-3">
              <label className="block text-sm font-bold text-gray-700">ターン制限時間</label>
              <select 
                value={turnTimeLimit} 
                onChange={(e) => setTurnTimeLimit(Number(e.target.value))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-medium focus:outline-none focus:ring-2 focus:ring-gray-900 bg-white"
              >
                <option value={0}>無制限 (なし)</option>
                <option value={15}>15秒</option>
                <option value={30}>30秒</option>
                <option value={60}>60秒 (1分)</option>
                <option value={120}>120秒 (2分)</option>
              </select>
            </div>

            <button
              onClick={() => {
                if (startPageMode === 'custom' && !customStartPage) {
                  showToast('スタートページを指定してください');
                  return;
                }
                setPhase(hasReachedConfirm ? 'confirm' : 'setup_p1');
              }}
              className="w-full py-3 px-4 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl shadow-lg transition-colors"
            >
              {hasReachedConfirm ? '確認へ戻る' : '目標設定に進む'}
            </button>

            {hasSaveData && (
              <div className="pt-4 border-t border-gray-200">
                <button
                  onClick={loadGame}
                  className="w-full py-3 px-4 bg-green-600 hover:bg-green-700 text-white font-bold rounded-xl shadow-lg transition-colors flex items-center justify-center gap-2"
                >
                  <Play className="w-5 h-5"/> 続きから遊ぶ
                </button>
                <button
                  onClick={() => {
                    if(window.confirm('セーブデータを削除しますか？')) clearSave();
                  }}
                  className="w-full mt-3 py-2 px-4 text-sm text-gray-500 hover:text-red-600 font-bold transition-colors flex items-center justify-center gap-1.5"
                >
                  <Trash2 className="w-4 h-4"/> データを消去
                </button>
              </div>
            )}
            
            {localStorage.getItem('wiki_soccer_past_records') && (
              <button
                onClick={() => setPhase('history')}
                className="w-full mt-3 py-3 px-4 bg-white border-2 border-gray-200 text-gray-700 font-bold rounded-xl shadow-sm hover:bg-gray-50 flex items-center justify-center gap-2 transition-colors"
              >
                プレイ履歴を見る
              </button>
            )}
            
            {toastMessage && (
              <div className="p-3 bg-red-100 text-red-800 rounded-lg text-sm text-center font-medium animate-in fade-in">
                {toastMessage}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (phase === 'setup_p1' || phase === 'setup_p2') {
    const isP1 = phase === 'setup_p1';
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-2xl shadow-xl">
          <div className={`p-6 text-white text-center rounded-t-2xl ${isP1 ? 'bg-red-600' : 'bg-blue-600'}`}>
            <h1 className="text-3xl font-bold mb-2">Wikipedia Soccer</h1>
            <p className="text-white/90">
              Player {isP1 ? '1 (先攻)' : '2 (後攻)'} の目標設定
            </p>
          </div>
          
          <div className="p-6 space-y-6">
            <div className="bg-orange-50 text-orange-800 p-4 rounded-xl text-sm font-medium border border-orange-200">
              <AlertCircle className="w-5 h-5 mb-2 inline-block mr-1" />
              対戦相手には画面を見せないでください！
            </div>

            <div className={`p-4 rounded-xl border ${isP1 ? 'bg-red-50 border-red-100' : 'bg-blue-50 border-blue-100'}`}>
              <div className="flex justify-between items-center mb-1">
                <label className={`block text-sm font-bold ${isP1 ? 'text-red-700' : 'text-blue-700'}`}>
                  あなたの目標ページ
                </label>
                <button
                  onClick={() => fetchRandomTarget(isP1 ? setP1Target : setP2Target)}
                  className={`flex items-center gap-1 text-xs font-bold px-2 py-1 rounded transition-colors ${isP1 ? 'bg-red-100 hover:bg-red-200 text-red-700' : 'bg-blue-100 hover:bg-blue-200 text-blue-700'}`}
                  title="ランダムな記事を設定"
                >
                  <Dices className="w-3 h-3" /> ランダム
                </button>
              </div>
              <WikiAutocomplete 
                value={isP1 ? p1Target : p2Target} 
                onChange={isP1 ? setP1Target : setP2Target} 
                placeholder="例: 織田信長" 
              />
            </div>
            
            {isP1 ? (
              <button
                onClick={handleNextSetup}
                className="w-full py-3 px-4 bg-gray-900 hover:bg-gray-800 text-white font-bold rounded-xl"
              >
                {hasReachedConfirm ? '確認へ戻る' : '次へ (Player 2 に渡す)'}
              </button>
            ) : (
              <button
                onClick={() => {
                  if (!p2Target) {
                    showToast('目標ページを設定してください');
                    return;
                  }
                  setHasReachedConfirm(true);
                  setPhase('confirm');
                }}
                className="w-full py-3 px-4 bg-gray-900 hover:bg-gray-800 text-white font-bold rounded-xl"
              >
                最終確認に進む
              </button>
            )}
            
            {toastMessage && (
              <div className="p-3 bg-red-100 text-red-800 rounded-lg text-sm text-center font-medium animate-in fade-in">
                {toastMessage}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (phase === 'history') {
    const pastRecords: PastGameRecord[] = JSON.parse(localStorage.getItem('wiki_soccer_past_records') || '[]');
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col p-4">
        <div className="max-w-2xl w-full mx-auto space-y-4 pt-10">
          <div className="flex items-center gap-4 mb-6">
             <button onClick={() => setPhase('settings')} className="p-2 bg-white rounded-full shadow-sm hover:bg-gray-50 transition-colors">
               <RotateCcw className="w-5 h-5 text-gray-600" />
             </button>
             <h1 className="text-2xl font-bold">プレイ履歴</h1>
          </div>
          {pastRecords.length === 0 ? (
             <div className="text-center text-gray-500 py-10 font-medium">履歴がありません</div>
          ) : (
             pastRecords.map(record => (
               <div key={record.id} className="bg-white rounded-xl shadow-sm p-5 border border-gray-100">
                 <div className="flex justify-between items-center mb-4 border-b pb-3">
                   <div className="font-bold text-sm text-gray-500">{record.date}</div>
                   <div className="font-bold text-lg flex items-center gap-1.5">
                     <Trophy className="w-5 h-5 text-yellow-500" />
                     Player {record.winner} Wins
                   </div>
                 </div>
                 <div className="space-y-3 mb-5 text-sm font-medium">
                   <div className="flex items-center gap-3">
                     <span className="font-bold text-red-600 w-16">P1 目標:</span>
                     <span>{record.p1Target} {record.winner === 1 && '🏆'}</span>
                   </div>
                   <div className="flex items-center gap-3">
                     <span className="font-bold text-blue-600 w-16">P2 目標:</span>
                     <span>{record.p2Target} {record.winner === 2 && '🏆'}</span>
                   </div>
                 </div>
                 <div className="text-sm bg-gray-50 p-4 rounded-lg overflow-x-auto whitespace-nowrap">
                   {record.history.map((entry, i) => (
                     <span key={i} className={`font-bold ${entry.player === 1 ? 'text-red-500' : 'text-blue-500'}`}>
                       <a href={`https://ja.wikipedia.org/wiki/${encodeURIComponent(entry.title)}`} target="_blank" rel="noopener noreferrer" className="hover:underline">
                         {entry.title}
                       </a>
                       {i < record.history.length - 1 && <span className="text-gray-400 mx-2">→</span>}
                     </span>
                   ))}
                 </div>
               </div>
             ))
          )}
        </div>
      </div>
    );
  }

  if (phase === 'confirm') {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-2xl shadow-xl">
          <div className="p-6 text-white text-center bg-gray-900 rounded-t-2xl">
             <h1 className="text-3xl font-bold mb-2">最終確認</h1>
             <p className="text-white/90">ゲーム設定の確認</p>
          </div>
          <div className="p-6 space-y-5">
            <div className="bg-gray-50 p-4 rounded-xl border border-gray-200 text-sm space-y-3">
              <div className="flex justify-between">
                <span className="text-gray-500 font-bold">スタートページ:</span>
                <span className="font-bold text-gray-900">{startPageMode === 'random' ? 'ランダム設定' : customStartPage}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500 font-bold">ターン制限時間:</span>
                <span className="font-bold text-gray-900">{turnTimeLimit > 0 ? `${turnTimeLimit}秒` : '無制限 (なし)'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500 font-bold">移動回数:</span>
                <span className="font-bold text-gray-900">1手目 {movesPhase1}回 / 以降 {movesPhaseN}回</span>
              </div>
            </div>
            
            <div className="space-y-3">
              <div className="p-4 bg-red-50 border border-red-100 rounded-xl flex justify-between items-center">
                <span className="font-bold text-red-700">Player 1 の目標:</span>
                <HiddenTargetItem target={p1Target} />
              </div>
              <div className="p-4 bg-blue-50 border border-blue-100 rounded-xl flex justify-between items-center">
                <span className="font-bold text-blue-700">Player 2 の目標:</span>
                <HiddenTargetItem target={p2Target} />
              </div>
            </div>

            <button
               onClick={startGame}
               disabled={isStarting}
               className="w-full mt-6 py-3 px-4 bg-green-600 hover:bg-green-700 text-white font-bold rounded-xl shadow-lg transition-colors flex items-center justify-center gap-2"
            >
               {isStarting ? (
                  <div className="h-5 w-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                  <> <Play className="w-5 h-5" /> Game Start</>
                )}
            </button>
            <div className="flex gap-2 mt-2">
              <button
                 onClick={() => setPhase('settings')}
                 className="flex-1 py-3 text-gray-600 hover:text-gray-800 text-xs font-bold transition-colors bg-gray-100 hover:bg-gray-200 rounded-xl"
              >
                 全体設定
              </button>
              <button
                 onClick={() => setPhase('setup_p1')}
                 className="flex-1 py-3 text-red-600 hover:text-red-800 text-xs font-bold transition-colors bg-red-50 hover:bg-red-100 rounded-xl border border-red-100"
              >
                 P1目標
              </button>
              <button
                 onClick={() => setPhase('setup_p2')}
                 className="flex-1 py-3 text-blue-600 hover:text-blue-800 text-xs font-bold transition-colors bg-blue-50 hover:bg-blue-100 rounded-xl border border-blue-100"
              >
                 P2目標
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const isP1 = currentPlayer === 1;
  const targetDisplay = showTarget ? currentTarget : '目を離して確認 →';
  
  return (
    <div className="h-screen w-full flex flex-col bg-slate-100 overflow-hidden relative">
      <div className="flex-none bg-white border-b shadow-sm z-10 w-full relative">
        <div className="absolute top-0 left-0 w-full h-1 bg-gray-200">
          <div 
            className={`h-full transition-all duration-300 ${isP1 ? 'bg-red-500' : 'bg-blue-500'}`} 
            style={{ width: `${(movesMade / maxMoves) * 100}%` }}
          />
        </div>
        
        <div className="max-w-full mx-auto px-4 py-3 flex flex-wrap sm:flex-nowrap items-center justify-between gap-4">
          
          <div className="flex flex-col flex-1 min-w-[200px]">
            <div className="flex items-center gap-2">
              <span className={`px-2 py-0.5 rounded text-xs font-bold ${isP1 ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700'}`}>
                Player {currentPlayer} のターン
              </span>
              <span className="text-xs text-gray-500 font-medium tracking-tight">Turn {turnCount}</span>
              <span className="text-sm font-bold text-gray-700 ml-2">
                移動: {movesMade} / {maxMoves}
              </span>
              {turnTimeLimit > 0 && (
                <span className={`text-sm font-bold ml-2 flex items-center gap-1 ${timeLeft <= 5 ? 'text-red-600 animate-pulse' : 'text-gray-700'}`}>
                  残り時間: {timeLeft}秒
                </span>
              )}
            </div>
            <div className="text-lg font-bold text-gray-900 flex items-center gap-2 mt-2">
              <button 
                onMouseDown={() => setShowTarget(true)}
                onMouseUp={() => setShowTarget(false)}
                onMouseLeave={() => setShowTarget(false)}
                onTouchStart={() => setShowTarget(true)}
                onTouchEnd={() => setShowTarget(false)}
                className="flex items-center gap-1.5 text-xs bg-gray-100 hover:bg-gray-200 px-2 py-1 rounded text-gray-600 transition-colors select-none"
              >
                {showTarget ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
                {showTarget ? '非表示' : '目標確認'}
              </button>
              <span className={`text-sm transition-colors ${showTarget ? 'text-blue-800' : 'text-gray-400 select-none tracking-widest'}`}>
                {showTarget ? currentTarget : '••••••••'}
              </span>
            </div>
          </div>
          
          <div className="flex items-center gap-2 w-full sm:w-auto justify-center">
            <button
              onClick={handleSaveAndQuit}
              className="px-3 py-2 flex items-center gap-1.5 text-sm font-medium border border-gray-200 rounded-lg bg-white hover:bg-gray-50 transition-colors text-gray-700"
              title="中断してトップに戻る"
            >
              <Save className="w-4 h-4" /> <span className="hidden sm:inline">中断</span>
            </button>
            <button
              onClick={handleUndo}
              disabled={movesMade === 0}
              className="px-4 py-2 flex items-center gap-1.5 text-sm font-medium border border-gray-200 rounded-lg bg-white hover:bg-gray-50 disabled:opacity-40 disabled:hover:bg-white transition-colors"
            >
              <RotateCcw className="w-4 h-4" /> 戻る
            </button>
            {movesMade >= maxMoves && (
              <button
                onClick={handleEndTurn}
                className={`px-5 py-2 flex items-center gap-1.5 text-sm font-bold rounded-lg transition-transform animate-in fade-in zoom-in-95 shadow-sm
                  ${isP1 ? 'bg-red-600 hover:bg-red-700 text-white' : 'bg-blue-600 hover:bg-blue-700 text-white'}
                `}
              >
                ターン交代 <ArrowRight className="w-4 h-4" />
              </button>
            )}
          </div>

        </div>
      </div>
      
      {toastMessage && (
        <div className="absolute top-24 left-1/2 -translate-x-1/2 z-50 animate-in fade-in slide-in-from-top-4">
          <div className="bg-gray-900 text-white px-6 py-3 rounded-full shadow-xl flex items-center gap-2 font-medium">
            <AlertCircle className="w-5 h-5 text-red-400" />
            {toastMessage}
          </div>
        </div>
      )}

      {/* Won View Overlay */}
      {phase === 'won' && (
        <div className="absolute inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="max-w-md w-full bg-white rounded-2xl shadow-2xl p-8 text-center space-y-6 animate-in slide-in-from-bottom-8">
            <div className="mx-auto w-20 h-20 bg-yellow-100 rounded-full flex items-center justify-center">
              <Trophy className="w-10 h-10 text-yellow-600" />
            </div>
            <h1 className="text-4xl font-bold text-gray-900">
              Player {winner} Wins!
            </h1>
            <p className="text-gray-600 font-medium">
              目標「{winner === 1 ? p1Target : p2Target}」に到達しました！
            </p>
            <div className="space-y-4">
              <a 
                href={`https://ja.wikipedia.org/wiki/${encodeURIComponent(winner === 1 ? p1Target : p2Target)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full block py-2 px-4 border-2 border-yellow-500 text-yellow-600 font-bold rounded-xl hover:bg-yellow-50 transition-colors"
              >
                到達した目標ページを見る
              </a>
              
              <div className="text-sm p-3 bg-slate-50 border border-slate-200 rounded-lg text-slate-600 text-left">
                <span className="font-bold flex items-center gap-1"><AlertCircle className="w-4 h-4"/> 惜敗側の情報</span>
                <p className="mt-1">Player {winner === 1 ? 2 : 1} の目標: <a href={`https://ja.wikipedia.org/wiki/${encodeURIComponent(winner === 1 ? p2Target : p1Target)}`} target="_blank" rel="noopener noreferrer" className="font-bold text-blue-600 hover:underline">{winner === 1 ? p2Target : p1Target}</a></p>
              </div>
            </div>
            
            <div className="text-left text-sm text-gray-500 bg-gray-50 p-4 rounded-lg break-words max-h-40 overflow-y-auto">
              <p className="font-bold mb-2 text-gray-700">移動履歴:</p>
              <div className="flex flex-wrap gap-1 leading-relaxed items-center">
                {globalHistory.map((entry, i) => (
                  <span key={i} className="flex items-center gap-1">
                    <a 
                      href={`https://ja.wikipedia.org/wiki/${encodeURIComponent(entry.title)}`} 
                      target="_blank" 
                      rel="noopener noreferrer" 
                      className={`font-bold hover:underline ${entry.player === 1 ? 'text-red-500' : 'text-blue-500'}`}
                    >
                      {entry.title}
                    </a>
                    {i < globalHistory.length - 1 && <span className="text-gray-400 mx-1 flex-shrink-0">→</span>}
                  </span>
                ))}
              </div>
            </div>
            
            <button
              onClick={() => {
                setPhase('settings');
                setP1Target('');
                setP2Target('');
                setHasReachedConfirm(false);
              }}
              className="w-full py-3 px-4 bg-gray-900 hover:bg-gray-800 text-white font-bold rounded-xl transition-colors"
            >
              最初から遊ぶ
            </button>
          </div>
        </div>
      )}

      <div className="flex-1 w-full bg-white relative">
        <iframe 
          key={currentPage}
          title="Wikipedia"
          src={`/proxy/wiki/${encodeURIComponent(currentPage)}`}
          className="w-full h-full border-0 absolute inset-0"
        />
      </div>
    </div>
  );
}

// Simple Autocomplete Component
function WikiAutocomplete({ value, onChange, placeholder }: { value: string, onChange: (v: string) => void, placeholder: string }) {
  const [results, setResults] = useState<string[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const debounceRef = useRef<number | null>(null);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let val = e.target.value;
    try {
      if (val.includes('wikipedia.org/wiki/')) {
        const url = new URL(val);
        const titleMatch = url.pathname.match(/\/wiki\/(.+)/);
        if (titleMatch && titleMatch[1]) {
          val = decodeURIComponent(titleMatch[1]).replace(/_/g, ' ');
        }
      }
    } catch(err) {
      // ignore
    }
    onChange(val);
  };

  useEffect(() => {
    if (!value) {
      setResults([]);
      return;
    }
    
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    
    debounceRef.current = window.setTimeout(async () => {
      try {
        const res = await fetch(`https://ja.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(value)}&limit=5&format=json&origin=*`);
        const data = await res.json();
        setResults(data[1] || []);
        if (data[1]?.length > 0) setIsOpen(true);
      } catch (e) {
        console.error('Search failed', e);
      }
    }, 300);
    
    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
  }, [value]);

  return (
    <div className="relative">
      <div className="relative flex items-center">
        <Search className="w-4 h-4 absolute left-3 text-gray-400" />
        <input
          type="text"
          value={value}
          onChange={handleInputChange}
          onFocus={() => { if (results.length > 0) setIsOpen(true); }}
          onBlur={() => setTimeout(() => setIsOpen(false), 200)}
          placeholder={placeholder}
          className="w-full pl-9 pr-3 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 font-medium"
        />
      </div>
      {isOpen && results.length > 0 && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-20 max-h-60 overflow-y-auto">
          {results.map((res) => (
            <div
              key={res}
              onClick={() => {
                onChange(res);
                setIsOpen(false);
              }}
              className="px-4 py-3 hover:bg-blue-50 border-b border-gray-50 last:border-0 cursor-pointer text-sm font-medium text-gray-700"
            >
              {res}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function HiddenTargetItem({ target }: { target: string }) {
  const [show, setShow] = useState(false);
  return (
    <div 
      className="flex items-center gap-2 cursor-pointer select-none px-2 py-1 bg-white rounded shadow-sm border border-gray-100"
      onMouseDown={() => setShow(true)}
      onMouseUp={() => setShow(false)}
      onMouseLeave={() => setShow(false)}
      onTouchStart={() => setShow(true)}
      onTouchEnd={() => setShow(false)}
    >
      {show ? <Eye className="w-4 h-4 text-gray-600" /> : <EyeOff className="w-4 h-4 text-gray-400" />}
      <span className={`font-bold transition-colors ${show ? 'text-gray-900' : 'text-gray-400 tracking-widest'}`}>
        {show ? target : '••••••••'}
      </span>
    </div>
  );
}

