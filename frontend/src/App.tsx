import React, { useState, useEffect, useRef } from 'react';
import { Mic, Square, Loader2, Moon, Sun, Menu, MoreVertical } from 'lucide-react';
import MarkmapHooks from './hooks/markmap-hooks';
import { useDarkMode } from './hooks/useDarkMode';

function App() {
  type TabContent = {
    英語: string[];
    日本語: string[];
  };

  const { isDarkMode, toggleDarkMode } = useDarkMode();
  // 会話データ型を拡張
  type Conversation = {
    id: number;
    name: string;
    logs: {
      英語: string[];
      日本語: string[];
    };
    mindmapMarkdown: string;
  };

  // conversationsの初期値を拡張
  const [conversations, setConversations] = useState<Conversation[]>([]);

  // アクティブな会話ID
  const [activeConversationId, setActiveConversationId] = useState<number>(conversations[0]?.id ?? 1);

  // アクティブな会話を取得
  const activeConversation = conversations.find(c => c.id === activeConversationId);

  // タブ内容・マインドマップはアクティブ会話から取得
  const [activeTab, setActiveTab] = useState('英語');
  const [generatedContent, setGeneratedContent] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [isGeneratingQuestion, setIsGeneratingQuestion] = useState(false);
  const [isGeneratingAnswer, setIsGeneratingAnswer] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [showOverlayResult, setShowOverlayResult] = useState(false);

  const englishTabRef = useRef<HTMLDivElement>(null);
  const japaneseTabRef = useRef<HTMLDivElement>(null);
  const [isAutoScrollEnabledEnglish, setIsAutoScrollEnabledEnglish] = useState(true);
  const [isAutoScrollEnabledJapanese, setIsAutoScrollEnabledJapanese] = useState(true);

  const handleScrollEnglish = () => {
    if (englishTabRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = englishTabRef.current;
      setIsAutoScrollEnabledEnglish(scrollTop + clientHeight >= scrollHeight - 10);
    }
  };

  const handleScrollJapanese = () => {
    if (japaneseTabRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = japaneseTabRef.current;
      setIsAutoScrollEnabledJapanese(scrollTop + clientHeight >= scrollHeight - 10);
    }
  };

  useEffect(() => {
    if (
      activeTab === '英語' &&
      englishTabRef.current &&
      isAutoScrollEnabledEnglish &&
      activeConversation &&
      activeConversation.logs
    ) {
      englishTabRef.current.scrollTop = englishTabRef.current.scrollHeight;
    }
  }, [activeConversation?.logs?.英語, activeTab, isAutoScrollEnabledEnglish]);

  useEffect(() => {
    if (
      activeTab === '日本語' &&
      japaneseTabRef.current &&
      isAutoScrollEnabledJapanese &&
      activeConversation &&
      activeConversation.logs
    ) {
      japaneseTabRef.current.scrollTop = japaneseTabRef.current.scrollHeight;
    }
  }, [activeConversation?.logs?.日本語, activeTab, isAutoScrollEnabledJapanese]);

  // 会話ログ追加時、アクティブ会話に反映
  // appendLog: activeConversationが存在しない場合は何もしない
  const appendLog = (lang: '英語' | '日本語', text: string) => {
    if (!activeConversation) return;
    setConversations(prev =>
      prev.map(conv =>
        conv.id === activeConversationId
          ? {
              ...conv,
              logs: {
                ...conv.logs,
                [lang]: [...(conv.logs?.[lang] ?? []), text],
              },
            }
          : conv
      )
    );
  };

  // WebSocket, AudioContext, MediaStreamをuseRefで管理
  const wsRef = useRef<WebSocket | null>(null);
  const contextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);

  const handleStartRecording = () => {
    navigator.mediaDevices.getUserMedia({ audio: true, video: false }).then((stream) => {
      streamRef.current = stream;
      const context = new AudioContext();
      contextRef.current = context;
      const input = context.createMediaStreamSource(stream);
      const processor = context.createScriptProcessor(1024, 1, 1);
      processorRef.current = processor;

      const ws = new WebSocket('wss://kikimimi-dev-548901182461.asia-northeast1.run.app');
      wsRef.current = ws;

      ws.onopen = () => {
        input.connect(processor);
        processor.connect(context.destination);

        processor.onaudioprocess = (e) => {
          if (ws.readyState === WebSocket.OPEN) {
            const voice = e.inputBuffer.getChannelData(0);
            try {
              ws.send(downsampleBuffer(voice, context.sampleRate, 16000));
            } catch (err) {
            }
          }
        };
      };

      ws.onmessage = (evt) => {
        try {
          const message = JSON.parse(evt.data);
          if (message.original) {
            appendLog('英語', message.original);
          }
          if (message.translated) {
            appendLog('日本語', message.translated);
          }
        } catch (error) {
          console.error('Failed to parse WebSocket message:', error);
        }
      };

      ws.onerror = (e) => {
        console.error('WebSocket error:', e);
      };

      ws.onclose = () => {
        processor.disconnect();
        input.disconnect();
        context.close();
      };

      setIsRecording(true);
    }).catch((err) => {
      console.error('getUserMedia error:', err);
      setIsRecording(false);
    });
  };

  const handleStopRecording = () => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    if (contextRef.current) {
      contextRef.current.close();
      contextRef.current = null;
    }
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    setIsRecording(false);
  };

  const downsampleBuffer = (buffer: Float32Array, sampleRate: number, outSampleRate: number) => {
    if (outSampleRate > sampleRate) {
      console.error('Downsampling rate should be smaller than original sample rate');
    }

    const sampleRateRatio = sampleRate / outSampleRate;
    const newLength = Math.round(buffer.length / sampleRateRatio);
    const result = new Int16Array(newLength);
    let offsetResult = 0;
    let offsetBuffer = 0;

    while (offsetResult < result.length) {
      const nextOffsetBuffer = Math.round((offsetResult + 1) * sampleRateRatio);
      let accum = 0;
      let count = 0;
      for (let i = offsetBuffer; i < nextOffsetBuffer && i < buffer.length; i++) {
        accum += buffer[i];
        count++;
      }
      result[offsetResult] = Math.min(1, accum / count) * 0x7FFF;
      offsetResult++;
      offsetBuffer = nextOffsetBuffer;
    }

    return result.buffer;
  };

  const handleGenerateQuestion = async () => {
    setIsGeneratingQuestion(true);
    setGeneratedContent('');

    try {
      const transcript = (activeConversation?.logs.英語 ?? []).join('\n');
      const response = await fetch('https://suggest-questions-548901182461.asia-northeast1.run.app', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ transcript: transcript, keyword: keyword }),
      });

      if (response.ok) {
        const data = await response.json();
        setGeneratedContent(data.response);
      } else {
        console.error('Failed to fetch questions:', response.statusText);
        setGeneratedContent('質問生成に失敗しました。');
      }
    } catch (error) {
      console.error('Error generating questions:', error);
      setGeneratedContent('質問生成中にエラーが発生しました。');
    } finally {
      setIsGeneratingQuestion(false);
    }
  };

  const handleGenerateAnswer = async () => {
    setIsGeneratingAnswer(true);
    setGeneratedContent('');

    try {
      const transcript = (activeConversation?.logs.英語 ?? []).join('\n');
      const response = await fetch('https://suggest-answers-548901182461.asia-northeast1.run.app', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ transcript: transcript, keyword: keyword }),
      });

      if (response.ok) {
        const data = await response.json();
        setGeneratedContent(data.response);
      } else {
        console.error('Failed to fetch answers:', response.statusText);
        setGeneratedContent('回答生成に失敗しました。');
      }
    } catch (error) {
      console.error('Error generating answers:', error);
      setGeneratedContent('回答生成中にエラーが発生しました。');
    } finally {
      setIsGeneratingAnswer(false);
    }
  };

  const renderStyledResponse = (text: string) => {
    const sections = text.split(/＜.*?回答＞/g).filter(Boolean);
    const labels = [...text.matchAll(/＜(.*?)回答＞/g)].map((m) => m[1]);

    const bgColors = {
      ポジティブ: 'bg-green-50 dark:bg-green-900/30',
      ニュートラル: 'bg-yellow-50 dark:bg-yellow-900/30',
      ネガティブ: 'bg-red-50 dark:bg-red-900/30',
    };

    return sections.map((section, idx) => {
      const type = labels[idx];
      const color = bgColors[type as keyof typeof bgColors] || 'bg-white dark:bg-slate-700 ';

      return section
        .split('\n')
        .filter(line => line.trim() !== '')
        .map((line, lineIdx) => {
          // 番号除去
          const cleanLine = line.replace(/^(\d+[\.\)]|\d+．|\d+、)\s*/, '');

          // (1) パターンA：英文（日本語） ← かっこ付き和訳の抽出
          const parenMatch = cleanLine.match(/^(.*?)[（(](.*?)[）)]\s*$/);
          if (parenMatch) {
            const english = parenMatch[1].trim();
            const japanese = parenMatch[2].trim();
            return (
              <div
                key={`${idx}-${lineIdx}`}
                className={`border border-slate-300 dark:border-slate-600 rounded-lg px-4 py-2 text-sm text-slate-800 dark:text-slate-100 ${color}`}
              >
                <div>{english}</div>
                <div className="text-xs text-slate-600 dark:text-slate-400 mt-1">{japanese}</div>
              </div>
            );
          }

          // (2) パターンB：英文 日本語（スペース区切り） ← 全角文字で自動分割
          const match = cleanLine.match(/^(.*?)([\u3000-\u4DBF\u4E00-\u9FFF].*)$/);
          let english = cleanLine;
          let japanese = '';
          if (match) {
            english = match[1].trim();
            japanese = match[2].trim();
          }

          return (
            <div
              key={`${idx}-${lineIdx}`}
              className={`border border-slate-300 dark:border-slate-600 rounded-lg px-4 py-2 text-sm text-slate-800 dark:text-slate-100 ${color}`}
            >
              <div>{english}</div>
              {japanese && (
                <div className="text-xs text-slate-600 dark:text-slate-400 mt-1">{japanese}</div>
              )}
            </div>
          );
        });
    });
  };

  // マインドマップの更新
  useEffect(() => {
    if (!activeConversation || !activeConversation.logs || !activeConversation.logs.英語 || activeConversation.logs.英語.length === 0) return;
    const transcript = activeConversation.logs.英語.slice(-10).join('\n');
    const fetchMindmap = async () => {
      try {
        const res = await fetch('https://update-mindmap-548901182461.asia-northeast1.run.app', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            markdown: activeConversation.mindmapMarkdown,
            transcript: transcript,
          }),
        });
        if (res.ok) {
          const data = await res.json();
          if (data.response) {
            // マインドマップをアクティブ会話に保存
            setConversations(prev =>
              prev.map(conv =>
                conv.id === activeConversationId
                  ? { ...conv, mindmapMarkdown: data.response }
                  : conv
              )
            );
          }
        }
      } catch (e) {
        // 何もしない
      }
    };
    fetchMindmap();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeConversation?.logs?.英語, activeConversationId]);
  
  // サイドバー開閉状態
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  // 3点メニューの開閉管理
  const [menuOpenId, setMenuOpenId] = useState<number | null>(null);

  // Rename用の状態
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState('');

  // サイドバー外クリックで閉じる
  const sidebarRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!isSidebarOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (
        sidebarRef.current &&
        !sidebarRef.current.contains(e.target as Node) &&
        !(e.target as HTMLElement).closest('#sidebar-hamburger')
      ) {
        setIsSidebarOpen(false);
        setMenuOpenId(null);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [isSidebarOpen]);

  // conversationsの初期値をlocalStorageから取得
  useEffect(() => {
    const stored = localStorage.getItem('conversations');
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          setConversations(parsed);
          if (parsed.length > 0) setActiveConversationId(parsed[0].id);
        }
      } catch {}
    } else {
      // 初回のみデフォルト値（新規の会話が一つだけ）
      const initial = [
        {
          id: 1,
          name: '新しい会話',
          logs: { 英語: [], 日本語: [] },
          mindmapMarkdown: '- Root',
        },
      ];
      setConversations(initial);
      setActiveConversationId(1);
      localStorage.setItem('conversations', JSON.stringify(initial));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // conversationsが変わるたびにlocalStorageへ保存
  useEffect(() => {
    if (conversations.length > 0) {
      localStorage.setItem('conversations', JSON.stringify(conversations));
    }
  }, [conversations]);

  // アクティブな会話IDはconversationsがセットされた後に有効なIDをセット
  useEffect(() => {
    if (
      conversations.length > 0 &&
      !conversations.some((c) => c.id === activeConversationId)
    ) {
      setActiveConversationId(conversations[0].id);
    }
  }, [conversations, activeConversationId]);

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 transition-colors duration-200">
      <header className="bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 px-6 py-4 transition-colors duration-200 relative z-30">
        <div className="flex justify-between items-center">
          {/* ハンバーガーメニュー＋ロゴを横並び */}
          <div className="flex items-center">
            <button
              id="sidebar-hamburger"
              onClick={() => setIsSidebarOpen((v) => !v)}
              aria-label="Open sidebar"
              className="mr-3 group flex flex-col justify-center items-center w-9 h-9 relative z-40 focus:outline-none"
              style={{ WebkitTapHighlightColor: 'transparent' }}
            >
              {/* 洗練されたハンバーガーアイコン */}
              <span
                className="block w-6 h-0.5 rounded bg-slate-700 dark:bg-slate-200 mb-1 transition-all duration-200 group-hover:bg-blue-500"
                style={{ marginTop: 2 }}
              />
              <span
                className="block w-6 h-0.5 rounded bg-slate-700 dark:bg-slate-200 mb-1 transition-all duration-200 group-hover:bg-blue-500"
              />
              <span
                className="block w-6 h-0.5 rounded bg-slate-700 dark:bg-slate-200 transition-all duration-200 group-hover:bg-blue-500"
                style={{ marginBottom: 2 }}
              />
            </button>
            <img src="/Kikimimi_logo-line.svg" alt="Kikimimi Logo" className="w-32 h-auto transition-colors duration-200"/>
          </div>
          <div className="flex items-center space-x-3">
            <button
              onClick={toggleDarkMode}
              className="p-2 rounded-lg bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-600 dark:text-slate-300 transition-all duration-200"
              aria-label="Toggle dark mode"
            >
              {isDarkMode ? <Sun size={18} /> : <Moon size={18} />}
            </button>

            <button
              onClick={isRecording ? handleStopRecording : handleStartRecording}
              className={`flex items-center space-x-2 px-5 py-2.5 rounded-lg font-medium transition-all duration-200 ${
                isRecording
                  ? 'bg-red-500 hover:bg-red-600 text-white animate-recording-pulse'
                  : 'bg-red-500 hover:bg-red-600 text-white hover:shadow-red-200'
              }`}
            >
              {isRecording ? (
                <>
                  <Square size={16} className="fill-current" />
                  <span>停止</span>
                </>
              ) : (
                <>
                  <Mic size={16} />
                  <span>開始</span>
                </>
              )}
            </button>
          </div>
        </div>
      </header>

      {/* サイドバー */}
      <div
        ref={sidebarRef}
        className={`fixed top-0 left-0 h-full w-64 bg-white dark:bg-slate-800 border-r border-slate-200 dark:border-slate-700 shadow-xl z-40 transition-transform duration-300 ease-in-out
          ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'}
        `}
        style={{ willChange: 'transform', paddingLeft: '8px', paddingRight: '8px' }}
      >
        <div className="flex flex-col h-full">
          <div className="px-4 py-5 border-b border-slate-200 dark:border-slate-700">
            <span className="text-lg font-bold text-slate-700 dark:text-slate-100">会話履歴</span>
          </div>
          <div className="flex-1 overflow-y-auto py-2">
            <ul className="space-y-1">
              <li>
                <button
                  className="flex items-center w-full px-4 py-2 rounded-lg text-blue-600 dark:text-blue-400 font-medium hover:bg-blue-50 dark:hover:bg-blue-900/30 transition text-sm"
                  onClick={() => {
                    setConversations(prev => {
                      const maxId = prev.length > 0 ? Math.max(...prev.map(c => c.id)) : 0;
                      const newId = maxId + 1;
                      setActiveConversationId(newId);
                      return [
                        {
                          id: newId,
                          name: '新しい会話',
                          logs: { 英語: [], 日本語: [] },
                          mindmapMarkdown: '- Root',
                        },
                        ...prev
                      ];
                    });
                  }}
                >
                  <span className="text-xl mr-2">＋</span>
                  新規作成
                </button>
              </li>
              {conversations.map((conv) => (
                <li key={conv.id} className="relative group">
                  <div
                    className={`flex items-center justify-between px-4 py-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition text-sm cursor-pointer ${
                      activeConversationId === conv.id
                        ? 'bg-blue-50 dark:bg-blue-900/30'
                        : ''
                    }`}
                    onClick={() => {
                      // 会話切り替え時に録音停止
                      if (isRecording) handleStopRecording();
                      setActiveConversationId(conv.id);
                      setMenuOpenId(null);
                      setRenamingId(null);
                      setGeneratedContent(''); // 質問回答生成の出力結果を削除
                      setKeyword(''); // キーワードInputFieldの値も削除
                    }}
                  >
                    {/* Rename中はinput、それ以外はspan */}
                    {renamingId === conv.id ? (
                      <form
                        onSubmit={e => {
                          e.preventDefault();
                          setConversations(prev =>
                            prev.map(c =>
                              c.id === conv.id ? { ...c, name: renameValue.trim() || c.name } : c
                            )
                          );
                          setRenamingId(null);
                          setMenuOpenId(null);
                        }}
                        className="flex-1"
                      >
                        <input
                          autoFocus
                          value={renameValue}
                          onChange={e => setRenameValue(e.target.value)}
                          onBlur={() => {
                            // 保存してリネーム解除
                            setConversations(prev =>
                              prev.map(c =>
                                c.id === conv.id ? { ...c, name: renameValue.trim() || c.name } : c
                              )
                            );
                            setRenamingId(null);
                            setMenuOpenId(null);
                          }}
                          onKeyDown={e => {
                            if (e.key === 'Escape') {
                              setRenamingId(null);
                              setMenuOpenId(null);
                            }
                          }}
                          className="w-full px-2 py-1 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 text-sm"
                        />
                      </form>
                    ) : (
                      <span className="truncate text-slate-800 dark:text-slate-100">{conv.name}</span>
                    )}
                    <button
                      className="ml-2 p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-600 transition"
                      onClick={e => {
                        e.stopPropagation();
                        // Renameボタンを押した時はinputにする
                        if (menuOpenId === conv.id) {
                          setMenuOpenId(null);
                        } else {
                          setMenuOpenId(conv.id);
                        }
                      }}
                      aria-label="Open menu"
                    >
                      <MoreVertical size={18} className="text-slate-400" />
                    </button>
                    {/* 3点メニュー */}
                    {menuOpenId === conv.id && (
                      <div className="absolute right-8 top-8 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded shadow-lg z-50 min-w-[120px]">
                        <button
                          className="block w-full text-left px-4 py-2 text-sm hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200"
                          onClick={e => {
                            e.stopPropagation();
                            setRenamingId(conv.id);
                            setRenameValue(conv.name);
                            setMenuOpenId(null);
                          }}
                        >
                          Rename
                        </button>
                        <button
                          className="block w-full text-left px-4 py-2 text-sm hover:bg-red-50 dark:hover:bg-red-900/30 text-red-600 dark:text-red-400"
                          onClick={() => {
                            setConversations(prev => {
                              const filtered = prev.filter(c => c.id !== conv.id);
                              // すべて削除された場合は新しい会話を1つ作成
                              if (filtered.length === 0) {
                                const newId = 1;
                                setActiveConversationId(newId);
                                return [
                                  {
                                    id: newId,
                                    name: '新しい会話',
                                    logs: { 英語: [], 日本語: [] },
                                    mindmapMarkdown: '- Root',
                                  },
                                ];
                              }
                              // 削除後のアクティブ会話を調整
                              if (activeConversationId === conv.id && filtered.length > 0) {
                                setActiveConversationId(filtered[0].id);
                              }
                              return filtered;
                            });
                            setMenuOpenId(null);
                            if (renamingId === conv.id) setRenamingId(null);
                          }}
                        >
                          Delete
                        </button>
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
      {/* サイドバーのオーバーレイ（モバイル時などで背景クリックで閉じる） */}
      {isSidebarOpen && (
        <div
          className="fixed inset-0 bg-black/20 dark:bg-black/40 z-30 transition-opacity duration-300"
          aria-hidden="true"
        />
      )}

      <div className="flex h-[calc(100vh-81px)] flex-wrap lg:flex-nowrap">
        {/* サイドバーのスペース確保は不要 */}
        <div className="w-full lg:w-80 bg-white dark:bg-slate-800 border-r border-slate-200 dark:border-slate-700 flex flex-col h-full transition-colors duration-200">
          <div className="p-5 pb-0">
            <div className="border-b border-slate-200 dark:border-slate-700">
              <nav className="flex space-x-0 overflow-x-auto" aria-label="Tabs">
                {['英語', '日本語'].map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    className={`flex-1 px-4 py-3 text-sm font-medium border-b-2 transition-all duration-200 ${
                      activeTab === tab
                        ? 'border-blue-500 text-blue-600 dark:text-blue-400 bg-blue-50/60 dark:bg-blue-900/20'
                        : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300 hover:border-slate-300 dark:hover:border-slate-600'
                    }`}
                  >
                    {tab}
                  </button>
                ))}
                <button
                  onClick={() => setActiveTab('マインドマップ')}
                  className={`flex-1 px-4 py-3 text-sm font-medium border-b-2 transition-all duration-200 lg:hidden ${
                    activeTab === 'マインドマップ'
                      ? 'border-blue-500 text-blue-600 dark:text-blue-400 bg-blue-50/60 dark:bg-blue-900/20'
                      : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300 hover:border-slate-300 dark:hover:border-slate-600'
                  }`}
                >
                  マインドマップ
                </button>
              </nav>
            </div>
          </div>

          <div
            ref={activeTab === '英語' ? englishTabRef : activeTab === '日本語' ? japaneseTabRef : null}
            onScroll={activeTab === '英語' ? handleScrollEnglish : activeTab === '日本語' ? handleScrollJapanese : undefined}
            className="flex-1 overflow-y-auto px-5 pt-5 pb-24"
          >
            <div className="space-y-3">
              {['英語', '日本語'].includes(activeTab) ? (
                (activeConversation?.logs?.[activeTab as '英語' | '日本語'] ?? []).map((content, index) => (
                  <div
                    key={index}
                    className="bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 p-4 rounded-lg hover:border-slate-300 dark:hover:border-slate-500 transition-all duration-200"
                  >
                    <div className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed">
                      {content}
                    </div>
                  </div>
                ))
              ) : (
                <MarkmapHooks markdown={activeConversation?.mindmapMarkdown ?? '- Root'} />
              )}
            </div>
          </div>
        </div>

        {/* モバイル用 */}
        <div className="lg:hidden fixed bottom-0 left-0 w-full bg-white dark:bg-slate-800 border-t border-slate-200 dark:border-slate-600 flex justify-around p-3 z-40 gap-4">
          <button
            onClick={async () => {
              await handleGenerateQuestion();
              setShowOverlayResult(true);
            }}
            disabled={isGeneratingQuestion || isGeneratingAnswer}
            className={`flex items-center justify-center space-x-2 px-6 py-3 rounded-lg transition-all duration-200 font-medium text-sm w-36 flex-1 min-h-0 ${
              isGeneratingQuestion
                ? 'bg-slate-700 text-white cursor-not-allowed'
                : isGeneratingAnswer
                ? 'bg-slate-300 text-slate-500 cursor-not-allowed'
                : 'bg-slate-700 dark:bg-slate-600 hover:bg-slate-800 dark:hover:bg-slate-500 text-white shadow-sm hover:shadow-md'
            }`}
          >
            {isGeneratingQuestion && <Loader2 size={16} className="animate-spin" />}
            <span>{isGeneratingQuestion ? '生成中...' : '質問生成'}</span>
          </button>
          <button
            onClick={async () => {
              await handleGenerateAnswer();
              setShowOverlayResult(true);
            }}
            disabled={isGeneratingQuestion || isGeneratingAnswer}
            className={`flex items-center justify-center space-x-2 px-6 py-3 rounded-lg transition-all duration-200 font-medium text-sm w-36 flex-1 min-h-0 ${
              isGeneratingAnswer
                ? 'bg-slate-700 text-white cursor-not-allowed'
                : isGeneratingQuestion
                ? 'bg-slate-300 text-slate-500 cursor-not-allowed'
                : 'bg-slate-700 dark:bg-slate-600 hover:bg-slate-800 dark:hover:bg-slate-500 text-white shadow-sm hover:shadow-md'
            }`}
          >
            {isGeneratingAnswer && <Loader2 size={16} className="animate-spin" />}
            <span>{isGeneratingAnswer ? '生成中...' : '回答生成'}</span>
          </button>
        </div>
        {showOverlayResult && (
          <div className="lg:hidden fixed bottom-14 left-0 w-full h-1/2 bg-white dark:bg-slate-900 border-t border-slate-300 dark:border-slate-600 z-50 p-4 overflow-y-auto shadow-2xl rounded-t-2xl">
            <div className="flex justify-end mb-2">
              <button
                onClick={() => setShowOverlayResult(false)}
                className="text-slate-600 dark:text-slate-300 text-sm"
              >
                ✕ 閉じる
              </button>
            </div>
            <div className="space-y-2">
              {renderStyledResponse(generatedContent)}
            </div>
          </div>
        )}

        {/* 大きい画面 */}
        <div className="flex-1 p-6 flex flex-col h-full overflow-hidden hidden lg:flex">
          <div className={`relative bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden h-full transition-colors duration-200 mb-6 flex-1 flex`}>
            <MarkmapHooks markdown={activeConversation?.mindmapMarkdown ?? '- Root'} />
          </div>

          <div className="relative bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-6 flex-shrink-0 transition-colors duration-200">
            {generatedContent && (
              <button
                onClick={() => setGeneratedContent('')}
                className="hidden lg:block absolute top-2 right-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors text-lg"
                aria-label="クリア"
              >
                ✕
              </button>
            )}
            <div className="flex gap-6">
              <div className="flex flex-col gap-4 flex-shrink-0 h-40 min-h-0">
                <button
                  onClick={handleGenerateQuestion}
                  disabled={isGeneratingQuestion || isGeneratingAnswer}
                  className={`flex items-center justify-center space-x-2 px-6 py-3 rounded-lg transition-all duration-200 font-medium text-sm w-36 flex-1 min-h-0 ${
                    isGeneratingQuestion
                      ? 'bg-slate-700 text-white cursor-not-allowed'
                      : isGeneratingAnswer
                      ? 'bg-slate-300 text-slate-500 cursor-not-allowed'
                      : 'bg-slate-700 dark:bg-slate-600 hover:bg-slate-800 dark:hover:bg-slate-500 text-white shadow-sm hover:shadow-md'
                  }`}
                >
                  {isGeneratingQuestion && <Loader2 size={16} className="animate-spin" />}
                  <span>{isGeneratingQuestion ? '生成中...' : '質問生成'}</span>
                </button>

                <button
                  onClick={handleGenerateAnswer}
                  disabled={isGeneratingQuestion || isGeneratingAnswer}
                  className={`flex items-center justify-center space-x-2 px-6 py-3 rounded-lg transition-all duration-200 font-medium text-sm w-36 flex-1 min-h-0 ${
                    isGeneratingAnswer
                      ? 'bg-slate-700 text-white cursor-not-allowed'
                      : isGeneratingQuestion
                      ? 'bg-slate-300 text-slate-500 cursor-not-allowed'
                      : 'bg-slate-700 dark:bg-slate-600 hover:bg-slate-800 dark:hover:bg-slate-500 text-white shadow-sm hover:shadow-md'
                  }`}
                >
                  {isGeneratingAnswer && <Loader2 size={16} className="animate-spin" />}
                  <span>{isGeneratingAnswer ? '生成中...' : '回答生成'}</span>
                </button>
                <input
                  type="text"
                  value={keyword}
                  onChange={(e) => setKeyword(e.target.value)}
                  placeholder="意図、キーワード"
                  className="px-4 py-3 border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all duration-200 text-sm leading-relaxed bg-white dark:bg-slate-700 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 w-36 flex-1 min-h-0"
                />
              </div>

              <div className="flex-1 overflow-y-auto space-y-2">
                {renderStyledResponse(generatedContent)}
              </div>

            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
