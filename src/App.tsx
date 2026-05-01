import React, { useState, useEffect, useRef } from 'react';
import { Search, Play, RotateCcw, ArrowRight, Trophy, AlertCircle, Eye, EyeOff, Save, Trash2, Dices, Globe } from 'lucide-react';
import { io, Socket } from 'socket.io-client';

type Phase = 'settings' | 'history' | 'setup' | 'confirm' | 'playing' | 'won' | 'online_setup' | 'online_waiting';

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
  moveTimeLimit: number;
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
  const [moveTimeLimit, setMoveTimeLimit] = useState<number>(0); // 0 = unlimited
  
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

  // Online Multiplayer State
  const [isOnline, setIsOnline] = useState(false);
  const [roomId, setRoomId] = useState('');
  const [socket, setSocket] = useState<Socket | null>(null);
  const [myPlayerNum, setMyPlayerNum] = useState<1 | 2 | 'spectator' | null>(null);
  const [p1Ready, setP1Ready] = useState(false);
  const [p2Ready, setP2Ready] = useState(false);
  const [cursorPos, setCursorPos] = useState<{x: number, y: number} | null>(null);
  const [isSuspended, setIsSuspended] = useState(false);
  const [undoRequest, setUndoRequest] = useState<{fromPlayer: 1 | 2} | null>(null);
  const [setupTargetPlayer, setSetupTargetPlayer] = useState<1 | 2 | null>(null);
  const [navCounter, setNavCounter] = useState(0);
  const [pageLoaded, setPageLoaded] = useState(false);
  const [isJoining, setIsJoining] = useState(false);
  const isFiringRandomMove = useRef(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    setHasSaveData(!!localStorage.getItem(SAVE_KEY));
  }, [phase]);

  const iframeKey = `${currentPage}-${globalHistory.length}-${navCounter}`;

  useEffect(() => {
    setPageLoaded(false);
  }, [currentPage]);

  // Online Multiplayer Socket Logic
  useEffect(() => {
    if (!socket) return;
    
    socket.on('sync_state', (state: any) => {
      if (state.startPageMode !== undefined) setStartPageMode(state.startPageMode);
      if (state.customStartPage !== undefined) setCustomStartPage(state.customStartPage);
      if (state.movesPhase1 !== undefined) setMovesPhase1(state.movesPhase1);
      if (state.movesPhaseN !== undefined) setMovesPhaseN(state.movesPhaseN);
      if (state.turnTimeLimit !== undefined) setTurnTimeLimit(state.turnTimeLimit);
      if (state.moveTimeLimit !== undefined) setMoveTimeLimit(state.moveTimeLimit);
      if (state.p1Target !== undefined && myPlayerNum !== 1) setP1Target(state.p1Target);
      if (state.p2Target !== undefined && myPlayerNum !== 2) setP2Target(state.p2Target);
      if (state.currentPlayer !== undefined) setCurrentPlayer(state.currentPlayer);
      if (state.turnCount !== undefined) setTurnCount(state.turnCount);
      if (state.movesMade !== undefined) setMovesMade(state.movesMade);
      if (state.currentPage !== undefined) setCurrentPage(state.currentPage);
      if (state.turnHistory !== undefined) setTurnHistory(state.turnHistory);
      if (state.globalHistory !== undefined) setGlobalHistory(state.globalHistory);
      if (state.timeLeft !== undefined) setTimeLeft(state.timeLeft);
      if (state.winner !== undefined) setWinner(state.winner);
      if (state.phase !== undefined) setPhase(state.phase);
      if (state.p1Ready !== undefined) setP1Ready(state.p1Ready);
      if (state.p2Ready !== undefined) setP2Ready(state.p2Ready);
      if (state.pageLoaded !== undefined) setPageLoaded(state.pageLoaded);
    });

    socket.on('sync_scroll', (data: { scrollY: number }) => {
      if (myPlayerNum !== currentPlayer) {
        // Send to iframe
        const iframe = document.querySelector('iframe');
        if (iframe && iframe.contentWindow) {
          iframe.contentWindow.postMessage({ type: 'SYNC_SCROLL', scrollY: data.scrollY }, '*');
        }
      }
    });

    socket.on('sync_cursor', (data: { x: number, y: number }) => {
      if (myPlayerNum !== currentPlayer) {
        setCursorPos({ x: data.x, y: data.y });
      }
    });

    socket.on('player_disconnected', (id) => {
      showToast('相手が通信を切断しました。タイトルに戻ります。');
      setPhase('settings');
      if (socket) socket.disconnect();
      setSocket(null);
      setIsOnline(false);
    });

    socket.on('suspend', () => {
      setIsSuspended(true);
      showToast('相手が中断しました');
    });

    socket.on('resume', () => {
      setIsSuspended(false);
      showToast('相手が再開しました');
    });

    socket.on('undo_request', (data: { fromPlayer: 1 | 2 }) => {
      setUndoRequest(data);
    });

    socket.on('undo_accept', () => {
      executeUndo();
      setUndoRequest(null);
    });

    socket.on('undo_deny', () => {
      setUndoRequest(null);
      showToast('戻るリクエストが拒否されました');
    });

    socket.on('sync_records', (records: PastGameRecord[]) => {
      localStorage.setItem('wiki_soccer_past_records', JSON.stringify(records));
    });

    return () => {
      socket.off('sync_state');
      socket.off('sync_scroll');
      socket.off('sync_cursor');
      socket.off('player_disconnected');
      socket.off('suspend');
      socket.off('resume');
      socket.off('undo_request');
      socket.off('undo_accept');
      socket.off('undo_deny');
      socket.off('sync_records');
    };
  }, [socket, myPlayerNum, currentPlayer]);

  const emitStateUpdate = (newStatePart: any) => {
    if (isOnline && socket && roomId) {
      socket.emit('sync_state', {
        roomId,
        state: newStatePart
      });
    }
  };

  const joinRoom = () => {
    if (isJoining) return;
    if (!roomId) {
      showToast('Room IDを入力してください');
      return;
    }
    setIsJoining(true);
    const newSocket = io();
    setSocket(newSocket);

    newSocket.emit('join_room', roomId);
    newSocket.on('room_full', () => {
      showToast('ルームが満員です');
      newSocket.disconnect();
      setSocket(null);
      setIsJoining(false);
    });
    newSocket.on('joined', (data: { playerNum: 1 | 2 | 'spectator' }) => {
      setMyPlayerNum(data.playerNum);
      setIsOnline(true);
      setIsJoining(false);

      if (data.playerNum === 'spectator') {
        setPhase('online_waiting');
        showToast('観戦者として参加しました');
      } else {
        setPhase('online_waiting');
      }

      newSocket.on('game_ready', () => {
        setPhase('setup');
        setP1Ready(false);
        setP2Ready(false);
        if (data.playerNum === 1) {
          newSocket.emit('sync_state', {
            roomId,
            state: {
              startPageMode,
              customStartPage,
              movesPhase1,
              movesPhaseN,
              turnTimeLimit,
              moveTimeLimit,
              phase: 'setup',
              p1Ready: false,
              p2Ready: false
            }
          });
        }
      });
    });
  };

  const maxMoves = turnCount === 1 ? movesPhase1 : movesPhaseN;
  const currentTarget = currentPlayer === 1 ? p1Target : p2Target;

  const showToast = (message: string) => {
    setToastMessage(message);
    setTimeout(() => setToastMessage(null), 4000);
  };

  const handleReady = (player: 1 | 2) => {
    if (player === 1) {
      if (!p1Target) return showToast('目標ページを設定してください');
      setP1Ready(true);
      if (isOnline && socket && roomId) {
        socket.emit('sync_state', { roomId, state: { p1Ready: true, p1Target } });
      }
      if (p2Ready) {
        setPhase('confirm');
        if (isOnline && socket && roomId) {
          socket.emit('sync_state', { roomId, state: { phase: 'confirm' } });
        }
      }
    } else {
      if (!p2Target) return showToast('目標ページを設定してください');
      setP2Ready(true);
      if (isOnline && socket && roomId) {
        socket.emit('sync_state', { roomId, state: { p2Ready: true, p2Target } });
      }
      if (p1Ready) {
        setPhase('confirm');
        if (isOnline && socket && roomId) {
          socket.emit('sync_state', { roomId, state: { phase: 'confirm' } });
        }
      }
    }
  };

  const handleLocalReady = () => {
    if (!p1Target || !p2Target) {
      showToast('両プレイヤーの目標を設定してください');
      return;
    }
    setP1Ready(true);
    setP2Ready(true);
    setPhase('confirm');
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
    if (!p1Target || !p2Target) {
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
      
      const initialTimeLeft = turnTimeLimit > 0 ? turnTimeLimit : moveTimeLimit;
      setCurrentPage(startPage);
      setGlobalHistory([{ title: startPage, player: 1 }]);
      setTurnHistory([startPage]);
      setCurrentPlayer(1);
      setTurnCount(1);
      setMovesMade(0);
      setWinner(null);
      setTimeLeft(initialTimeLeft);
      setPhase('playing');
      setNavCounter(c => c + 1);
      emitStateUpdate({
        currentPage: startPage,
        globalHistory: [{ title: startPage, player: 1 }],
        turnHistory: [startPage],
        currentPlayer: 1,
        turnCount: 1,
        movesMade: 0,
        winner: null,
        timeLeft: initialTimeLeft,
        phase: 'playing',
        p1Target,
        p2Target
      });
    } catch (e) {
      showToast('ランダム記事の取得に失敗しました');
    } finally {
      setIsStarting(false);
    }
  };

  const handleLinkClick = (rawTitle: string) => {
    isFiringRandomMove.current = false;
    if (phase !== 'playing') return;
    if (isSuspended) {
      showToast('中断中は操作できません');
      return;
    }
    if (isOnline && myPlayerNum !== currentPlayer) {
      showToast('相手のターン中です');
      return;
    }

    let decodedTitle = '';
    try {
      decodedTitle = decodeURIComponent(rawTitle).replace(/_/g, ' ');
    } catch(e) {
      decodedTitle = rawTitle.replace(/_/g, ' ');
    }

    // Skip self-referencing links (link to current page) to prevent undo issues
    if (decodedTitle === currentPage) {
      return;
    }
    
    // Win condition check - ALWAYS allows navigation if it's the target page!
    if (decodedTitle === currentTarget) {
      setCurrentPage(decodedTitle);
      setNavCounter(c => c + 1);
      
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
      const newRecords = [record, ...pastRecords].slice(0, 50);
      localStorage.setItem('wiki_soccer_past_records', JSON.stringify(newRecords));
      
      if (isOnline && socket && roomId) {
        socket.emit('sync_record', { roomId, record });
      }
      
      emitStateUpdate({ currentPage: decodedTitle, globalHistory: finalHistory, winner: currentPlayer, phase: 'won' });
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
    setNavCounter(c => c + 1);
    if (moveTimeLimit > 0) {
      setTimeLeft(moveTimeLimit);
    }
    setGlobalHistory(h => [...h, { title: decodedTitle, player: currentPlayer }]);
    setTurnHistory(th => [...th, decodedTitle]);
    emitStateUpdate({ currentPage: decodedTitle, movesMade: movesMade + 1, timeLeft: moveTimeLimit > 0 ? moveTimeLimit : timeLeft });
  };

  useEffect(() => {
    const handleMessage = (e: MessageEvent) => {
      if (e.data) {
        if (e.data.type === 'WIKI_LINK_CLICK') {
          handleLinkClick(e.data.title);
        } else if (e.data.type === 'WIKI_SCROLL' && isOnline && myPlayerNum === currentPlayer) {
          socket?.emit('sync_scroll', { roomId, scrollY: e.data.scrollY });
        } else if (e.data.type === 'WIKI_CURSOR' && isOnline && myPlayerNum === currentPlayer) {
          socket?.emit('sync_cursor', { roomId, x: e.data.x, y: e.data.y });
} else if (e.data.type === 'RANDOM_LINK_RESULT') {
          if (e.data.title) {
            let randomTitle = '';
            try {
              randomTitle = decodeURIComponent(e.data.title).replace(/_/g, ' ');
            } catch(err) {
              randomTitle = e.data.title.replace(/_/g, ' ');
            }
            if (randomTitle === currentPage) {
              handleEndTurn();
            } else {
              handleLinkClick(e.data.title);
            }
          } else {
            handleEndTurn();
          }
        }
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [movesMade, maxMoves, currentTarget, currentPlayer, phase, isOnline, myPlayerNum, socket, roomId, currentPage]);

  const handleEndTurn = () => {
    isFiringRandomMove.current = false;
    if (isOnline && myPlayerNum !== currentPlayer) return;
    if (isSuspended) return;
    const nextPlayer = currentPlayer === 1 ? 2 : 1;
    const newTimeLeft = turnTimeLimit > 0 ? turnTimeLimit : moveTimeLimit;
    setCurrentPlayer(nextPlayer);
    setTurnCount(c => c + 1);
    setMovesMade(0);
    setTurnHistory([currentPage]);
    setTimeLeft(newTimeLeft);
    emitStateUpdate({ currentPlayer: nextPlayer, turnCount: turnCount + 1, movesMade: 0, turnHistory: [currentPage], timeLeft: newTimeLeft });
  };

  useEffect(() => {
    if (phase !== 'playing' || isSuspended) return;
    if (!pageLoaded) return;

    const limit = turnTimeLimit > 0 ? turnTimeLimit : moveTimeLimit;
    if (limit === 0) return;
    
    if (timeLeft <= 0) {
      if (turnTimeLimit > 0) {
        handleEndTurn();
      } else if (moveTimeLimit > 0) {
        if (movesMade >= maxMoves) {
          handleEndTurn();
        } else if (!isOnline || myPlayerNum === currentPlayer) {
          if (!isFiringRandomMove.current) {
            isFiringRandomMove.current = true;
            const iframe = iframeRef.current;
            if (iframe && iframe.contentWindow) {
              iframe.contentWindow.postMessage({ type: 'GET_RANDOM_LINK', currentTitle: currentPage }, '*');
            }
          }
        }
      }
      return;
    }
    
    const startedAt = Date.now();
    const intervalMs = 200;
    const intervalId = setInterval(() => {
      const elapsedMs = Date.now() - startedAt;
      const elapsed = Math.floor(elapsedMs / 1000);
      const corrected = Math.max(0, timeLeft - elapsed);
      if (corrected !== timeLeft) {
        setTimeLeft(corrected);
      } else if (elapsed >= 1) {
        setTimeLeft(t => Math.max(0, t - 1));
      }
    }, intervalMs);
    
    return () => clearInterval(intervalId);
  }, [timeLeft, phase, turnTimeLimit, moveTimeLimit, currentPage, currentPlayer, isSuspended, movesMade, maxMoves, pageLoaded]);

const executeUndo = () => {
    setTurnHistory(prev => {
      if (prev.length <= 1) return prev;
      const newHistory = [...prev];
      newHistory.pop();
      const previousPage = newHistory[newHistory.length - 1];

      setCurrentPage(previousPage);
      setMovesMade(m => Math.max(0, m - 1));
      setNavCounter(c => c + 1);
      if (moveTimeLimit > 0) {
        setTimeLeft(moveTimeLimit);
      }

      setGlobalHistory(g => {
        const newGlobal = [...g];
        newGlobal.pop();
        emitStateUpdate({ currentPage: previousPage, turnHistory: newHistory, movesMade: movesMade > 0 ? movesMade - 1 : 0, globalHistory: newGlobal });
        return newGlobal;
      });
      return newHistory;
    });
  };

  const handleUndo = () => {
    if (isOnline && myPlayerNum !== currentPlayer) return;
    if (isSuspended) return;
    if (turnHistory.length <= 1) return;
    
    if (isOnline) {
      socket?.emit('undo_request', { roomId, fromPlayer: myPlayerNum });
      showToast('相手に「戻る」をリクエストしました...');
    } else {
      executeUndo();
    }
  };

  const handleSuspend = () => {
    if (isOnline) {
      setIsSuspended(true);
      socket?.emit('suspend', { roomId });
      showToast('ゲームを中断しました（相手は待機中です）');
    }
  };

  const handleResume = () => {
    if (isOnline) {
      setIsSuspended(false);
      socket?.emit('resume', { roomId });
      showToast('ゲームを再開しました');
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
      moveTimeLimit,
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
    if (isOnline) {
      socket?.emit('player_disconnected', { roomId });
      socket?.disconnect();
      setSocket(null);
      setIsOnline(false);
    }
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
        setMoveTimeLimit(state.moveTimeLimit || 0);
        setP1Target(state.p1Target);
        setP2Target(state.p2Target);
        setCurrentPlayer(state.currentPlayer);
        setTurnCount(state.turnCount);
        setMovesMade(state.movesMade);
        setCurrentPage(state.currentPage);
        setTurnHistory(state.turnHistory);
        setGlobalHistory((state.globalHistory || []).map(entry => typeof entry === 'string' ? { title: entry, player: 1 } : entry));
        setTimeLeft(state.timeLeft);
        setNavCounter(c => c + 1);
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
              <label className="block text-sm font-bold text-gray-700">制限時間</label>
              <select 
                value={`${turnTimeLimit > 0 ? 'turn-' : moveTimeLimit > 0 ? 'move-' : 'none-'}${turnTimeLimit || moveTimeLimit}`}
                onChange={(e) => {
                  const [mode, valStr] = e.target.value.split('-');
                  const val = Number(valStr);
                  if (mode === 'turn') {
                    setTurnTimeLimit(val);
                    setMoveTimeLimit(0);
                  } else if (mode === 'move') {
                    setMoveTimeLimit(val);
                    setTurnTimeLimit(0);
                  } else {
                    setTurnTimeLimit(0);
                    setMoveTimeLimit(0);
                  }
                }}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-medium focus:outline-none focus:ring-2 focus:ring-gray-900 bg-white"
              >
                <option value="none-0">無制限</option>
                <option value="turn-15">ターン制限: 15秒</option>
                <option value="turn-30">ターン制限: 30秒</option>
                <option value="turn-60">ターン制限: 60秒</option>
                <option value="turn-120">ターン制限: 120秒</option>
                <option value="move-10">1移動制限: 10秒</option>
                <option value="move-15">1移動制限: 15秒</option>
                <option value="move-20">1移動制限: 20秒</option>
                <option value="move-30">1移動制限: 30秒</option>
              </select>
              <p className="text-xs text-gray-500">
                {moveTimeLimit > 0 ? '時間切れでランダムなリンクに自動移動します' : turnTimeLimit > 0 ? '時間切れでターンが交代します' : '時間制限なしでプレイします'}
              </p>
            </div>

              <button
                onClick={() => {
                  if (startPageMode === 'custom' && !customStartPage) {
                    showToast('スタートページを指定してください');
                    return;
                  }
                  if (p1Ready && p2Ready) {
                    setPhase('confirm');
                  } else {
                    setPhase('setup');
                  }
                }}
              className="w-full py-3 px-4 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl shadow-lg transition-colors"
            >
              {p1Ready && p2Ready ? '保存して戻る' : '目標設定に進む'}
            </button>

            {!isOnline && (
              <div className="pt-4 border-t border-gray-200 space-y-3">
                <button
                  onClick={() => setPhase('online_setup')}
                  className="w-full py-3 px-4 bg-purple-600 hover:bg-purple-700 text-white font-bold rounded-xl shadow-lg transition-colors flex items-center justify-center gap-2"
                >
                  <Globe className="w-5 h-5"/> オンライン対戦
                </button>
              </div>
            )}

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

  if (phase === 'setup') {
    if (isOnline && myPlayerNum === 'spectator') {
      return (
        <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
          <div className="text-xl font-bold text-gray-600 animate-pulse">プレイヤーの設定を待っています...</div>
        </div>
      );
    }

    const isP1 = !isOnline || myPlayerNum === 1;
    const isP2 = !isOnline || myPlayerNum === 2;
    const showLocalTabs = !isOnline;

    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-2xl shadow-xl">
          <div className="p-6 text-white text-center bg-gray-900 rounded-t-2xl">
            <h1 className="text-3xl font-bold mb-2">Wikipedia Soccer</h1>
            <p className="text-white/90">目標ページの設定</p>
          </div>
          
          <div className="p-6 space-y-6">
            <div className="bg-orange-50 text-orange-800 p-4 rounded-xl text-sm font-medium border border-orange-200">
              <AlertCircle className="w-5 h-5 mb-2 inline-block mr-1" />
              対戦相手には画面が見えないようにしてください！
            </div>

            {showLocalTabs && (
              <div className="flex gap-2">
                <button
                  onClick={() => setSetupTargetPlayer(prev => prev === 1 ? null : 1)}
                  className={`flex-1 py-2 rounded-lg font-bold text-sm ${setupTargetPlayer === 1 ? 'bg-red-600 text-white' : 'bg-gray-100 text-gray-600'}`}
                >
                  {setupTargetPlayer === 1 ? 'Player 1 を閉じる' : 'Player 1 を設定'}
                </button>
                <button
                  onClick={() => setSetupTargetPlayer(prev => prev === 2 ? null : 2)}
                  className={`flex-1 py-2 rounded-lg font-bold text-sm ${setupTargetPlayer === 2 ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600'}`}
                >
                  {setupTargetPlayer === 2 ? 'Player 2 を閉じる' : 'Player 2 を設定'}
                </button>
              </div>
            )}

            {isP1 && (!showLocalTabs || setupTargetPlayer === 1) && (
              <div className={`p-4 rounded-xl border ${p1Ready ? 'bg-gray-100 border-gray-200 opacity-70' : 'bg-red-50 border-red-100'}`}>
                <div className="flex justify-between items-center mb-1">
                  <label className="block text-sm font-bold text-red-700">
                    Player 1 の目標
                  </label>
                  {!p1Ready && (
                    <button
                      onClick={() => fetchRandomTarget(setP1Target)}
                      className="flex items-center gap-1 text-xs font-bold px-2 py-1 rounded transition-colors bg-red-100 hover:bg-red-200 text-red-700"
                    >
                      <Dices className="w-3 h-3" /> ランダム
                    </button>
                  )}
                </div>
                {p1Ready ? (
                  <div className="space-y-2">
                    <div className="py-3 px-3 font-medium text-gray-700 bg-white rounded border">
                      {p1Target} (準備完了)
                    </div>
                    <button
onClick={() => {
                        setP1Ready(false);
                        emitStateUpdate({ p1Ready: false });
                      }}
                      className="w-full py-2 px-4 bg-gray-200 hover:bg-gray-300 text-gray-800 font-bold rounded-lg text-sm transition-colors"
                    >
                      編集に戻る
                    </button>
                  </div>
                ) : (
                  <WikiAutocomplete 
                    value={p1Target} 
                    onChange={setP1Target} 
                    placeholder="例: 織田信長" 
                  />
                )}
                {isOnline && !p1Ready && (
                  <button
                    onClick={() => handleReady(1)}
                    className="w-full mt-3 py-2 px-4 bg-red-600 hover:bg-red-700 text-white font-bold rounded-lg"
                  >
                    設定完了
                  </button>
                )}
              </div>
            )}

            {isP2 && (!showLocalTabs || setupTargetPlayer === 2) && (
              <div className={`p-4 rounded-xl border ${p2Ready ? 'bg-gray-100 border-gray-200 opacity-70' : 'bg-blue-50 border-blue-100'}`}>
                <div className="flex justify-between items-center mb-1">
                  <label className="block text-sm font-bold text-blue-700">
                    Player 2 の目標
                  </label>
                  {!p2Ready && (
                    <button
                      onClick={() => fetchRandomTarget(setP2Target)}
                      className="flex items-center gap-1 text-xs font-bold px-2 py-1 rounded transition-colors bg-blue-100 hover:bg-blue-200 text-blue-700"
                    >
                      <Dices className="w-3 h-3" /> ランダム
                    </button>
                  )}
                </div>
                {p2Ready ? (
                  <div className="space-y-2">
                    <div className="py-3 px-3 font-medium text-gray-700 bg-white rounded border">
                      {p2Target} (準備完了)
                    </div>
                    <button
                      onClick={() => {
                        setP2Ready(false);
                        emitStateUpdate({ p2Ready: false });
                      }}
                      className="w-full py-2 px-4 bg-gray-200 hover:bg-gray-300 text-gray-800 font-bold rounded-lg text-sm transition-colors"
                    >
                      編集に戻る
                    </button>
                  </div>
                ) : (
                  <WikiAutocomplete
                    value={p2Target}
                    onChange={setP2Target}
                    placeholder="例: 織田信長"
                  />
                )}
                {isOnline && !p2Ready && (
                  <button
                    onClick={() => handleReady(2)}
                    className="w-full mt-3 py-2 px-4 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg"
                  >
                    設定完了
                  </button>
                )}
              </div>
            )}

            {!isOnline && (
              <button
                onClick={handleLocalReady}
                disabled={!p1Target || !p2Target}
                className="w-full py-3 px-4 bg-gray-900 hover:bg-gray-800 disabled:bg-gray-300 disabled:cursor-not-allowed text-white font-bold rounded-xl shadow-lg transition-colors"
              >
                設定完了
              </button>
            )}

            {isOnline && (myPlayerNum === 1 ? p1Ready && !p2Ready : p2Ready && !p1Ready) && (
              <div className="text-center font-bold text-gray-500 animate-pulse py-2">
                相手の準備を待っています...
              </div>
            )}

          </div>
        </div>
      </div>
    );
  }

  if (phase === 'online_setup') {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-2xl shadow-xl">
          <div className="p-6 text-white text-center bg-purple-600 rounded-t-2xl">
            <h1 className="text-3xl font-bold mb-2">オンライン対戦</h1>
            <p className="text-white/90">ルームに参加または作成</p>
          </div>
          <div className="p-6 space-y-6">
            <div className="space-y-3">
              <label className="block text-sm font-bold text-gray-700">Room ID</label>
              <input
                type="text"
                value={roomId}
                onChange={e => setRoomId(e.target.value)}
                placeholder="例: my-room-123"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-medium focus:outline-none focus:ring-2 focus:ring-purple-600"
              />
            </div>
            <button
              onClick={joinRoom}
              disabled={isJoining}
              className="w-full py-3 px-4 bg-purple-600 hover:bg-purple-700 disabled:bg-purple-400 disabled:cursor-not-allowed text-white font-bold rounded-xl shadow-lg transition-colors"
            >
              {isJoining ? '参加中...' : 'ルームに参加 / 作成'}
            </button>
            <button
              onClick={() => setPhase('settings')}
              className="w-full py-3 px-4 bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold rounded-xl transition-colors"
            >
              戻る
            </button>
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

  if (phase === 'online_waiting') {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-2xl shadow-xl p-8 text-center space-y-6">
          <Globe className="w-16 h-16 text-purple-600 mx-auto animate-pulse" />
          <h1 className="text-2xl font-bold text-gray-900">対戦相手を待っています...</h1>
          <p className="text-gray-600 font-medium">Room ID: <span className="font-bold text-purple-600">{roomId}</span></p>
          <button
            onClick={() => {
              if (socket) socket.disconnect();
              setSocket(null);
              setIsOnline(false);
              setPhase('settings');
            }}
            className="w-full py-3 px-4 bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold rounded-xl transition-colors mt-4"
          >
            キャンセル
          </button>
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
                <span className="text-gray-500 font-bold">制限時間:</span>
                <span className="font-bold text-gray-900">{moveTimeLimit > 0 ? `1移動制限: ${moveTimeLimit}秒` : turnTimeLimit > 0 ? `ターン制限: ${turnTimeLimit}秒` : '無制限 (なし)'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500 font-bold">移動回数:</span>
                <span className="font-bold text-gray-900">1手目 {movesPhase1}回 / 以降 {movesPhaseN}回</span>
              </div>
            </div>
            
            <div className="space-y-3">
              <div className="p-4 bg-red-50 border border-red-100 rounded-xl flex justify-between items-center">
                <span className="font-bold text-red-700">Player 1 の目標:</span>
                {(myPlayerNum === 1 || myPlayerNum === 'spectator' || !isOnline) ? <HiddenTargetItem target={p1Target} /> : <span className="font-bold text-gray-400">????????</span>}
              </div>
              <div className="p-4 bg-blue-50 border border-blue-100 rounded-xl flex justify-between items-center">
                <span className="font-bold text-blue-700">Player 2 の目標:</span>
                {(myPlayerNum === 2 || myPlayerNum === 'spectator' || !isOnline) ? <HiddenTargetItem target={p2Target} /> : <span className="font-bold text-gray-400">????????</span>}
              </div>
            </div>

            <button
               onClick={startGame}
               disabled={isStarting || (isOnline && myPlayerNum !== 1)}
               className="w-full mt-6 py-3 px-4 bg-green-600 hover:bg-green-700 text-white font-bold rounded-xl shadow-lg transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
            >
               {isStarting ? (
                  <div className="h-5 w-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (isOnline && myPlayerNum !== 1) ? (
                  <> Player 1の開始を待機中...</>
                ) : (
                  <> <Play className="w-5 h-5" /> Game Start</>
                )}
            </button>
            <div className="flex gap-2 mt-2">
              <button
                 onClick={() => setPhase('settings')}
                 className="flex-1 py-3 text-gray-600 hover:text-gray-800 text-xs font-bold transition-colors bg-gray-100 hover:bg-gray-200 rounded-xl"
              >
                 全設定
              </button>
              <button
                 onClick={() => {
                   if (isOnline) {
                     if (myPlayerNum === 1) setP1Ready(false);
                     if (myPlayerNum === 2) setP2Ready(false);
                     setPhase('setup');
emitStateUpdate({
                        p1Ready: myPlayerNum === 1 ? false : p1Ready,
                        p2Ready: myPlayerNum === 2 ? false : p2Ready,
                        phase: 'setup'
                      });
                    } else {
                      setP1Ready(false);
                      setP2Ready(false);
                      setSetupTargetPlayer(null);
                      setPhase('setup');
                    }
                 }}
                 className="flex-1 py-3 text-indigo-600 hover:text-indigo-800 text-xs font-bold transition-colors bg-indigo-50 hover:bg-indigo-100 rounded-xl border border-indigo-100"
              >
                 目標再設定
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const isP1 = currentPlayer === 1;
  const targetDisplay = showTarget ? currentTarget : '目を離して確認 →';
  const isMyTurn = !isOnline || myPlayerNum === currentPlayer;
  const isSpectator = myPlayerNum === 'spectator';
  
  return (
    <div className="h-screen w-full flex flex-col bg-slate-100 overflow-hidden relative">
      {!isMyTurn && !isSpectator && isOnline && phase === 'playing' && (
        <div className="absolute top-0 left-1/2 -translate-x-1/2 z-50 bg-gray-900 text-white px-6 py-1 rounded-b-xl shadow-lg font-bold text-sm animate-pulse">
          Player {currentPlayer} のターン
        </div>
      )}
      {isMyTurn && isOnline && phase === 'playing' && (
        <div className="absolute top-0 left-1/2 -translate-x-1/2 z-50 bg-green-600 text-white px-6 py-1 rounded-b-xl shadow-lg font-bold text-sm animate-pulse">
          あなたのターンです！
        </div>
      )}
      {isSpectator && isOnline && phase === 'playing' && (
        <div className="absolute top-0 left-1/2 -translate-x-1/2 z-50 bg-purple-600 text-white px-6 py-1 rounded-b-xl shadow-lg font-bold text-sm">
          観戦中 - Player {currentPlayer}のターン
        </div>
      )}
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
              {(turnTimeLimit > 0 || moveTimeLimit > 0) && (
                <span className={`text-sm font-bold ml-2 flex items-center gap-1 ${timeLeft <= 5 ? 'text-red-600' : 'text-gray-700'}`}>
                  {moveTimeLimit > 0 ? '移動時間' : '残り時間'}: {timeLeft}秒
                  <span
                    className="inline-block"
                    style={{
                      display: 'inline-block',
                      width: '8px',
                      height: '8px',
                      borderRadius: '50%',
                      backgroundColor: timeLeft <= 5 ? '#dc2626' : '#6b7280',
                      transition: 'transform 0.9s cubic-bezier(0.4, 0, 0.2, 1), background-color 0.3s',
                      transform: timeLeft <= 5 ? 'scale(1.5)' : 'scale(1)',
                      WebkitTransform: timeLeft <= 5 ? 'scale(1.5)' : 'scale(1)',
                    }}
                  />
                </span>
              )}
            </div>
            <div className="text-lg font-bold text-gray-900 flex items-center gap-2 mt-2">
              {(isMyTurn || isSpectator || !isOnline) ? (
                <>
                  <button 
                    onMouseDown={() => setShowTarget(true)}
                    onMouseUp={() => setShowTarget(false)}
                    onMouseLeave={() => setShowTarget(false)}
                    onTouchStart={() => setShowTarget(true)}
                    onTouchEnd={() => setShowTarget(false)}
                    className="flex items-center gap-1.5 text-xs bg-gray-100 hover:bg-gray-200 px-2 py-1 rounded text-gray-600 transition-colors select-none"
                  >
                    {showTarget ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
                    {showTarget ? '表示中' : '目標確認'}
                  </button>
                  <span className={`text-sm transition-colors ${showTarget ? 'text-blue-800' : 'text-gray-400 select-none tracking-widest'}`}>
                    {showTarget ? currentTarget : '????????'}
                  </span>
                </>
              ) : (
                <>
                  <button className="flex items-center gap-1.5 text-xs bg-gray-100 px-2 py-1 rounded text-gray-400 cursor-not-allowed select-none">
                    <EyeOff className="w-3 h-3" />
                    相手の目標は秘密です
                  </button>
                  <span className="text-sm text-gray-400 select-none tracking-widest">
                    ????????
                  </span>
                </>
              )}
            </div>
          </div>
          
          <div className="flex items-center gap-2 w-full sm:w-auto justify-center">
            {!isSpectator && (
              <>
                {isOnline ? (
                  isSuspended ? (
                    <button
                      onClick={handleResume}
                      className="px-3 py-2 flex items-center gap-1.5 text-sm font-medium border border-green-200 rounded-lg bg-green-50 hover:bg-green-100 transition-colors text-green-700"
                    >
                      <Play className="w-4 h-4" /> <span className="hidden sm:inline">再開</span>
                    </button>
                  ) : (
                    <button
                      onClick={handleSuspend}
                      className="px-3 py-2 flex items-center gap-1.5 text-sm font-medium border border-gray-200 rounded-lg bg-white hover:bg-gray-50 transition-colors text-gray-700"
                      title="ゲームを一時中断"
                    >
                      <Save className="w-4 h-4" /> <span className="hidden sm:inline">中断</span>
                    </button>
                  )
                ) : (
                  <button
                    onClick={handleSaveAndQuit}
                    className="px-3 py-2 flex items-center gap-1.5 text-sm font-medium border border-gray-200 rounded-lg bg-white hover:bg-gray-50 transition-colors text-gray-700"
                    title="中断してトップに戻る"
                  >
                    <Save className="w-4 h-4" /> <span className="hidden sm:inline">中断</span>
                  </button>
                )}
              </>
            )}
            {isMyTurn && !isSuspended && (
              <>
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
                    ターン終了 <ArrowRight className="w-4 h-4" />
                  </button>
                )}
              </>
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

      {isSuspended && (
        <div className="absolute inset-0 z-40 bg-black/40 backdrop-blur-[2px] flex items-center justify-center">
          <div className="bg-white rounded-2xl shadow-2xl p-8 text-center space-y-4 max-w-sm mx-4">
            <div className="mx-auto w-16 h-16 bg-yellow-100 rounded-full flex items-center justify-center">
              <Save className="w-8 h-8 text-yellow-600" />
            </div>
            <h2 className="text-xl font-bold text-gray-900">ゲームが中断されています</h2>
            <p className="text-gray-600">相手の再開を待っています...</p>
            {isOnline && myPlayerNum !== 'spectator' && (
              <button
                onClick={handleResume}
                className="w-full py-2 px-4 bg-green-600 hover:bg-green-700 text-white font-bold rounded-lg"
              >
                自分で再開する
              </button>
            )}
          </div>
        </div>
      )}

      {undoRequest && undoRequest.fromPlayer !== myPlayerNum && (
        <div className="absolute inset-0 z-40 bg-black/40 backdrop-blur-[2px] flex items-center justify-center">
          <div className="bg-white rounded-2xl shadow-2xl p-8 text-center space-y-4 max-w-sm mx-4">
            <div className="mx-auto w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center">
              <RotateCcw className="w-8 h-8 text-blue-600" />
            </div>
            <h2 className="text-xl font-bold text-gray-900">Player {undoRequest.fromPlayer} が「戻る」をリクエストしています</h2>
            <p className="text-gray-600">1つ前のページに戻りますか？</p>
            <div className="flex gap-3">
              <button
                onClick={() => {
                  socket?.emit('undo_deny', { roomId });
                  setUndoRequest(null);
                }}
                className="flex-1 py-2 px-4 bg-gray-200 hover:bg-gray-300 text-gray-800 font-bold rounded-lg"
              >
                拒否
              </button>
              <button
                onClick={() => {
                  socket?.emit('undo_accept', { roomId });
                  executeUndo();
                  setUndoRequest(null);
                }}
                className="flex-1 py-2 px-4 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg"
              >
                許可
              </button>
            </div>
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
              {isSpectator ? `Player ${winner} の勝利！` : (myPlayerNum === winner || !isOnline ? (winner === 1 ? 'Player 1 Wins!' : 'Player 2 Wins!') : 'You Lose...')}
            </h1>
            {isOnline && !isSpectator && myPlayerNum === winner && (
              <p className="text-xl font-bold text-green-600">You Win!</p>
            )}
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
                if (isOnline) {
                   setP1Target('');
                   setP2Target('');
                   setP1Ready(false);
                   setP2Ready(false);
                   setPhase('setup');
                   emitStateUpdate({ p1Target: '', p2Target: '', phase: 'setup', p1Ready: false, p2Ready: false });
                } else {
                   setPhase('settings');
                   setP1Target('');
                   setP2Target('');
                   setHasReachedConfirm(false);
                }
              }}
              className="w-full py-3 px-4 bg-gray-900 hover:bg-gray-800 text-white font-bold rounded-xl transition-colors"
            >
              {isOnline ? 'もう一度遊ぶ（再戦）' : '最初から遊ぶ'}
            </button>
          </div>
        </div>
      )}

      <div className="flex-1 w-full bg-white relative">
        {!isMyTurn && isOnline && cursorPos && (
          <div
            className="absolute w-4 h-4 bg-red-500 rounded-full z-50 pointer-events-none opacity-60 transform -translate-x-1/2 -translate-y-1/2 transition-all duration-75 shadow-md border-2 border-white"
            style={{ left: `${cursorPos.x * 100}%`, top: `${cursorPos.y * 100}%` }}
          />
        )}
        <iframe
          key={iframeKey}
          ref={iframeRef}
          title="Wikipedia"
          src={currentPage ? `/proxy/wiki/${encodeURIComponent(currentPage)}` : ''}
          onLoad={() => {
            setPageLoaded(true);
            if (isOnline && myPlayerNum === currentPlayer) {
              emitStateUpdate({ pageLoaded: true });
            }
          }}
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

