import { useState, useEffect, useRef } from "react";

const SNAP_MINUTES = 1;
const PALETTE = [
  "#EF4444","#F97316","#EAB308","#22C55E","#06B6D4",
  "#3B82F6","#8B5CF6","#EC4899","#F43F5E","#14B8A6",
];
const STORAGE_KEY = "timerapp_v2";
const TICK_LEFT = 42; // px - wider padding for tick labels

function loadStorage() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}; } catch { return {}; }
}
function saveStorage(data) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}
function minutesOfDay(date) { return date.getHours() * 60 + date.getMinutes(); }
function formatTime(totalMinutes) {
  const h = Math.floor(((totalMinutes % 1440) + 1440) % 1440 / 60);
  const m = ((totalMinutes % 1440) + 1440) % 1440 % 60;
  return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}`;
}
function todayString() {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,"0")}-${String(n.getDate()).padStart(2,"0")}`;
}

export default function App() {
  const now = new Date();
  const nowMin = minutesOfDay(now);
  const stored = loadStorage();
  const todayStr = todayString();

  const [displayMode, setDisplayMode] = useState(stored.displayMode ?? 0);
  const [customRange, setCustomRange] = useState(stored.customRange ?? null);
  const [tasks, setTasks] = useState(stored.tasks ?? []);
  const [backpack, setBackpack] = useState(stored.backpack ?? []);
  const [elapsedColor, setElapsedColor] = useState(stored.elapsedColor ?? "#22C55E");
  const [currentTime, setCurrentTime] = useState(nowMin);
  const [currentEpoch, setCurrentEpoch] = useState(Date.now());

  const [dragState, setDragState] = useState(null);
  const [pendingRange, setPendingRange] = useState(null);
  const [expandedTaskIds, setExpandedTaskIds] = useState({});
  const [showBackpack, setShowBackpack] = useState(false);
  const [showElapsedPicker, setShowElapsedPicker] = useState(false);

  const timelineRef = useRef(null);
  const taskDragRef = useRef(null);

  // Persist
  useEffect(() => {
    saveStorage({ displayMode, customRange, tasks, backpack, elapsedColor });
  }, [displayMode, customRange, tasks, backpack, elapsedColor]);

  // Clock tick
  useEffect(() => {
    const id = setInterval(() => {
      setCurrentTime(minutesOfDay(new Date()));
      setCurrentEpoch(Date.now());
    }, 15000);
    return () => clearInterval(id);
  }, []);

  // Auto-delete tasks older than 24h
  useEffect(() => {
    const cutoff = currentEpoch - 24 * 60 * 60 * 1000;
    setTasks(ts => ts.filter(t => !t.createdAt || t.createdAt > cutoff));
  }, [currentEpoch]);

  // Auto-place daily/weekly backpack items once per day
  useEffect(() => {
    const lastDate = stored.lastAutoPlaceDate;
    if (lastDate === todayStr) return;
    const todayDow = new Date().getDay(); // 0=日,1=月,...,6=土
    const autoItems = backpack.filter(b =>
      b.daily || (b.weekdays && b.weekdays.includes(todayDow))
    );
    if (autoItems.length === 0) {
      saveStorage({ ...loadStorage(), lastAutoPlaceDate: todayStr });
      return;
    }
    setTasks(ts => {
      let next = [...ts];
      autoItems.forEach(template => {
        const alreadyToday = next.some(t => t.name === template.name && t.placedDate === todayStr);
        if (alreadyToday) return;
        const last = next.filter(t => t.name === template.name).sort((a,b) => b.end - a.end)[0];
        const dur = last ? last.end - last.start : 60;
        const startMin = last ? last.start : nowMin;
        next.push({
          ...template,
          id: Date.now().toString() + Math.random(),
          start: startMin,
          end: startMin + dur,
          placedDate: todayStr,
          createdAt: Date.now(),
        });
      });
      return next;
    });
    saveStorage({ ...loadStorage(), lastAutoPlaceDate: todayStr });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Visible range
  const visibleRange = (() => {
    if (displayMode === 0) return { start: currentTime - 720, end: currentTime + 720 };
    if (displayMode === 1) return { start: currentTime - 60, end: currentTime + 1440 };
    if (displayMode === 2 && customRange) return customRange;
    return { start: currentTime - 720, end: currentTime + 720 };
  })();
  const rangeSpan = visibleRange.end - visibleRange.start;

  function yToMin(y) {
    const rect = timelineRef.current?.getBoundingClientRect();
    if (!rect) return 0;
    return Math.round((visibleRange.start + (y / rect.height) * rangeSpan) / SNAP_MINUTES) * SNAP_MINUTES;
  }
  function minToPercent(min) {
    return ((min - visibleRange.start) / rangeSpan) * 100;
  }

  // Timeline drag
  function onTimelinePointerDown(e) {
    if (taskDragRef.current) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const rect = timelineRef.current.getBoundingClientRect();
    const min = yToMin(e.clientY - rect.top);
    setDragState({ startMin: min, endMin: min });
  }
  function onTimelinePointerMove(e) {
    if (taskDragRef.current) {
      const rect = timelineRef.current.getBoundingClientRect();
      const min = yToMin(e.clientY - rect.top);
      const { taskId, edge } = taskDragRef.current;
      setTasks(ts => ts.map(t => {
        if (t.id !== taskId) return t;
        if (edge === "top") return { ...t, start: Math.min(min, t.end - 1) };
        return { ...t, end: Math.max(min, t.start + 1) };
      }));
      return;
    }
    if (!dragState) return;
    const rect = timelineRef.current.getBoundingClientRect();
    setDragState(d => ({ ...d, endMin: yToMin(e.clientY - rect.top) }));
  }
  function onTimelinePointerUp() {
    if (taskDragRef.current) { taskDragRef.current = null; return; }
    if (!dragState) return;
    const s = Math.min(dragState.startMin, dragState.endMin);
    const en = Math.max(dragState.startMin, dragState.endMin);
    if (en - s >= 1) setPendingRange({ start: s, end: en });
    setDragState(null);
  }
  function onTaskEdgePointerDown(e, taskId, edge) {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    taskDragRef.current = { taskId, edge };
  }

  // Task CRUD
  function handleCreateTask() {
    const newTask = {
      id: Date.now().toString(),
      name: "新しいタスク",
      memo: "",
      color: PALETTE[tasks.length % PALETTE.length],
      start: pendingRange.start,
      end: pendingRange.end,
      createdAt: Date.now(),
      placedDate: todayStr,
    };
    setTasks(ts => [...ts, newTask]);
    setExpandedTaskIds(ex => ({ ...ex, [newTask.id]: true }));
    setPendingRange(null);
  }
  function handleZoom() {
    setCustomRange(pendingRange);
    setDisplayMode(2);
    setPendingRange(null);
  }
  function updateTask(id, patch) {
    setTasks(ts => ts.map(t => t.id === id ? { ...t, ...patch } : t));
  }
  function deleteTask(id) {
    setTasks(ts => ts.filter(t => t.id !== id));
  }
  function saveToBackpackFromTask(task) {
    const { id:_, start:_s, end:_e, createdAt:_c, placedDate:_p, ...template } = task;
    setBackpack(bp => {
      const exists = bp.findIndex(b => b.name === template.name);
      if (exists >= 0) { const n=[...bp]; n[exists]=template; return n; }
      return [...bp, template];
    });
  }
  function applyBackpack(template) {
    const last = tasks.filter(t => t.name === template.name).sort((a,b) => b.end - a.end)[0];
    const dur = last ? last.end - last.start : 60;
    const startMin = last ? last.start : currentTime;
    const newTask = {
      ...template,
      id: Date.now().toString(),
      start: startMin,
      end: startMin + dur,
      createdAt: Date.now(),
      placedDate: todayStr,
    };
    setTasks(ts => [...ts, newTask]);
    setExpandedTaskIds(ex => ({ ...ex, [newTask.id]: true }));
    setShowBackpack(false);
  }
  function deleteBackpack(i) {
    setBackpack(bp => bp.filter((_,j) => j !== i));
  }

  const modeLabels = ["±12h", "-1h+24h", ...(customRange ? ["拡大"] : [])];

  // Styles
  const inputStyle = {
    background:"#0f172a", border:"1px solid #334155", borderRadius:4,
    color:"#e2e8f0", fontSize:13, padding:"5px 8px", outline:"none",
    width:"100%", boxSizing:"border-box",
  };
  function actionBtn(bg) {
    return { background:bg+"22", border:`1px solid ${bg}`, borderRadius:4,
      color:bg, fontSize:11, padding:"5px 8px", cursor:"pointer" };
  }

  // Render ticks
  function renderTicks() {
    const ticks = [];
    const startH = Math.ceil(visibleRange.start / 60);
    const endH = Math.floor(visibleRange.end / 60);
    for (let h = startH; h <= endH; h++) {
      const pct = minToPercent(h * 60);
      if (pct < 0 || pct > 100) continue;
      const label = `${String(((h%24)+24)%24).padStart(2,"0")}:00`;
      ticks.push(
        <div key={h} style={{ position:"absolute", top:`${pct}%`, left:0, right:0, display:"flex", alignItems:"center" }}>
          <span style={{ fontSize:11, color:"#94a3b8", width:TICK_LEFT, textAlign:"right", paddingRight:5, flexShrink:0 }}>{label}</span>
          <div style={{ flex:1, height:1, background:"rgba(148,163,184,0.3)" }} />
        </div>
      );
      const pct30 = minToPercent(h * 60 + 30);
      if (pct30 >= 0 && pct30 <= 100) {
        ticks.push(
          <div key={`${h}-30`} style={{ position:"absolute", top:`${pct30}%`, left:TICK_LEFT, right:0, height:1, background:"rgba(148,163,184,0.1)" }} />
        );
      }
    }
    return ticks;
  }

  function renderElapsed() {
    const nowPct = Math.max(0, Math.min(100, minToPercent(currentTime)));
    const topPct = Math.max(0, minToPercent(visibleRange.start));
    if (nowPct <= topPct) return null;
    return (
      <div style={{ position:"absolute", left:TICK_LEFT, right:0, top:`${topPct}%`, height:`${nowPct-topPct}%`,
        background:elapsedColor+"33", borderRight:`2px solid ${elapsedColor}`, pointerEvents:"none" }} />
    );
  }

  function renderNowLine() {
    const pct = minToPercent(currentTime);
    if (pct < 0 || pct > 100) return null;
    return (
      <div style={{ position:"absolute", top:`${pct}%`, left:TICK_LEFT, right:0,
        display:"flex", alignItems:"center", zIndex:10, pointerEvents:"none" }}>
        <div style={{ width:7, height:7, borderRadius:"50%", background:"#f87171", flexShrink:0 }} />
        <div style={{ flex:1, height:2, background:"#f87171" }} />
        <span style={{ fontSize:11, color:"#f87171", paddingLeft:2 }}>{formatTime(currentTime)}</span>
      </div>
    );
  }

  function renderTaskBoxes() {
    return tasks.map(task => {
      const topPct = minToPercent(task.start);
      const btmPct = minToPercent(task.end);
      const heightPct = btmPct - topPct;
      if (btmPct < 0 || topPct > 100) return null;
      return (
        <div key={task.id}
          onPointerDown={e => { e.stopPropagation(); setExpandedTaskIds(ex => ({ ...ex, [task.id]: !ex[task.id] })); }}
          style={{ position:"absolute", left:TICK_LEFT+3, right:2,
            top:`${Math.max(0,topPct)}%`, height:`${Math.min(heightPct,100-Math.max(0,topPct))}%`,
            minHeight:12, background:task.color+"55", border:`1.5px solid ${task.color}`,
            borderRadius:4, zIndex:5, cursor:"pointer", overflow:"hidden" }}>
          <span style={{ fontSize:11, color:"#e2e8f0", paddingLeft:4, paddingTop:1, display:"block",
            whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>
            {task.name}
          </span>
          <div onPointerDown={e=>onTaskEdgePointerDown(e,task.id,"top")}
            style={{ position:"absolute",top:0,left:0,right:0,height:14,cursor:"ns-resize",
              display:"flex",justifyContent:"center",alignItems:"center" }}>
            <div style={{ width:22,height:2,background:"rgba(255,255,255,0.6)",borderRadius:1 }} />
          </div>
          <div onPointerDown={e=>onTaskEdgePointerDown(e,task.id,"bottom")}
            style={{ position:"absolute",bottom:0,left:0,right:0,height:14,cursor:"ns-resize",
              display:"flex",justifyContent:"center",alignItems:"center" }}>
            <div style={{ width:22,height:2,background:"rgba(255,255,255,0.6)",borderRadius:1 }} />
          </div>
        </div>
      );
    });
  }

  function renderDragOverlay() {
    if (!dragState) return null;
    const s = minToPercent(Math.min(dragState.startMin, dragState.endMin));
    const e = minToPercent(Math.max(dragState.startMin, dragState.endMin));
    return (
      <div style={{ position:"absolute", left:TICK_LEFT+3, right:2,
        top:`${Math.max(0,s)}%`, height:`${e-s}%`,
        background:"rgba(148,163,184,0.2)", border:"1px dashed #94a3b8",
        pointerEvents:"none", zIndex:15 }}>
        <span style={{ position:"absolute", bottom:-16, left:0, fontSize:10, color:"#94a3b8", whiteSpace:"nowrap" }}>
          {formatTime(Math.min(dragState.startMin,dragState.endMin))}〜{formatTime(Math.max(dragState.startMin,dragState.endMin))}
        </span>
      </div>
    );
  }

  function renderTaskList() {
    return (
      <div style={{ display:"flex", flexDirection:"column", height:"100%", overflow:"hidden" }}>
        <div style={{ padding:"12px 10px 6px", fontSize:12, color:"#94a3b8", fontWeight:600, letterSpacing:1 }}>タスク一覧</div>
        <div style={{ flex:1, overflowY:"auto", padding:"0 8px 8px" }}>
          {tasks.length === 0 && <div style={{ fontSize:12, color:"#475569", padding:"8px 2px" }}>タスクがありません</div>}
          {tasks.map(task => {
            const isOpen = !!expandedTaskIds[task.id];
            return (
              <div key={task.id} style={{ marginBottom:8, borderRadius:7, background:"#1e293b", borderLeft:`3px solid ${task.color}`, overflow:"hidden" }}>
                {/* Header */}
                <div onClick={()=>setExpandedTaskIds(ex=>({...ex,[task.id]:!isOpen}))}
                  style={{ display:"flex", alignItems:"center", padding:"9px 8px", cursor:"pointer", gap:6 }}>
                  <span style={{ fontSize:13, color:"#e2e8f0", fontWeight:500, flex:1, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                    {task.name}
                  </span>
                  <span style={{ fontSize:10, color:"#64748b", whiteSpace:"nowrap" }}>{formatTime(task.start)}〜{formatTime(task.end)}</span>
                  <span style={{ fontSize:11, color:"#475569" }}>{isOpen?"▲":"▼"}</span>
                </div>
                {/* Expanded */}
                {isOpen && (
                  <div style={{ padding:"0 8px 10px", display:"flex", flexDirection:"column", gap:8 }}>
                    <input value={task.name} onChange={e=>updateTask(task.id,{name:e.target.value})}
                      placeholder="タスク名" style={inputStyle} />
                    <textarea value={task.memo} onChange={e=>updateTask(task.id,{memo:e.target.value})}
                      placeholder="メモ" rows={2} style={{...inputStyle,resize:"none"}} />
                    <div style={{ display:"flex", gap:6 }}>
                      <div style={{ flex:1, display:"flex", flexDirection:"column", gap:3 }}>
                        <span style={{ fontSize:10, color:"#94a3b8" }}>開始</span>
                        <input type="time"
                          value={`${String(Math.floor(((task.start%1440)+1440)%1440/60)).padStart(2,"0")}:${String(((task.start%1440)+1440)%1440%60).padStart(2,"0")}`}
                          onChange={e=>{const[h,m]=e.target.value.split(":").map(Number);updateTask(task.id,{start:h*60+m});}}
                          style={inputStyle} />
                      </div>
                      <div style={{ flex:1, display:"flex", flexDirection:"column", gap:3 }}>
                        <span style={{ fontSize:10, color:"#94a3b8" }}>終了</span>
                        <input type="time"
                          value={`${String(Math.floor(((task.end%1440)+1440)%1440/60)).padStart(2,"0")}:${String(((task.end%1440)+1440)%1440%60).padStart(2,"0")}`}
                          onChange={e=>{const[h,m]=e.target.value.split(":").map(Number);updateTask(task.id,{end:h*60+m});}}
                          style={inputStyle} />
                      </div>
                    </div>
                    <div style={{ display:"flex", flexWrap:"wrap", gap:6 }}>
                      {PALETTE.map(c=>(
                        <div key={c} onClick={()=>updateTask(task.id,{color:c})}
                          style={{ width:22,height:22,borderRadius:"50%",background:c,cursor:"pointer",
                            border:task.color===c?"2px solid #fff":"2px solid transparent",
                            boxShadow:task.color===c?"0 0 0 1px #fff":"none" }} />
                      ))}
                    </div>
                    <div style={{ display:"flex", gap:5 }}>
                      <button onClick={()=>saveToBackpackFromTask(task)} style={actionBtn("#8b5cf6")}>📦 保存</button>
                      <button onClick={()=>deleteTask(task.id)} style={{...actionBtn("#ef4444"),marginLeft:"auto"}}>削除</button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Backpack */}
        <div style={{ padding:"8px", borderTop:"1px solid #1e293b", flexShrink:0 }}>
          <button onClick={()=>setShowBackpack(b=>!b)}
            style={{ width:"100%", padding:"8px", background:"#1e293b", border:"1px solid #334155",
              borderRadius:6, color:"#94a3b8", fontSize:12, cursor:"pointer" }}>
            📦 バックパック {backpack.length > 0 ? `(${backpack.length})` : ""}
          </button>
          {showBackpack && (
            <div style={{ marginTop:6, maxHeight:220, overflowY:"auto" }}>
              {backpack.length===0 && <div style={{fontSize:11,color:"#475569",padding:4}}>保存なし</div>}
              {backpack.map((b,i)=>{
                const DOW_LABELS = ["日","月","火","水","木","金","土"];
                const weekdays = b.weekdays || [];
                const hasWeekday = weekdays.length > 0;
                return (
                  <div key={i} style={{ marginBottom:6, background:"#0f172a", borderRadius:4, borderLeft:`3px solid ${b.color}`, overflow:"hidden" }}>
                    {/* 1行目: 名前・毎日・曜日・適用・削除 */}
                    <div style={{ display:"flex", alignItems:"center", gap:5, padding:"6px 8px" }}>
                      <span onClick={()=>applyBackpack(b)} style={{ fontSize:12,color:"#e2e8f0",flex:1,cursor:"pointer",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>{b.name}</span>
                      {/* 毎日トグル */}
                      <div onClick={()=>setBackpack(bp=>bp.map((x,j)=>j===i?{...x,daily:!x.daily}:x))}
                        style={{ display:"flex",alignItems:"center",gap:3,cursor:"pointer",padding:"2px 5px",borderRadius:10,flexShrink:0,
                          background:b.daily?"#166534":"#1e293b",border:b.daily?"1px solid #22c55e":"1px solid #334155" }}>
                        <div style={{ width:7,height:7,borderRadius:"50%",background:b.daily?"#22c55e":"#475569" }}/>
                        <span style={{ fontSize:9,color:b.daily?"#22c55e":"#475569",whiteSpace:"nowrap" }}>毎日</span>
                      </div>
                      {/* 曜日トグル */}
                      <div onClick={()=>setBackpack(bp=>bp.map((x,j)=>j===i?{...x,weekdays: hasWeekday?[]:[1]}:x))}
                        style={{ display:"flex",alignItems:"center",gap:3,cursor:"pointer",padding:"2px 5px",borderRadius:10,flexShrink:0,
                          background:hasWeekday?"#1e3a5f":"#1e293b",border:hasWeekday?"1px solid #3b82f6":"1px solid #334155" }}>
                        <div style={{ width:7,height:7,borderRadius:"50%",background:hasWeekday?"#3b82f6":"#475569" }}/>
                        <span style={{ fontSize:9,color:hasWeekday?"#3b82f6":"#475569",whiteSpace:"nowrap" }}>曜日</span>
                      </div>
                      <span onClick={()=>applyBackpack(b)} style={{ fontSize:10,color:"#60a5fa",cursor:"pointer",whiteSpace:"nowrap",flexShrink:0 }}>適用</span>
                      <button onClick={()=>deleteBackpack(i)}
                        style={{ background:"none",border:"none",color:"#ef4444",fontSize:14,cursor:"pointer",padding:"0 2px",lineHeight:1,flexShrink:0 }}>×</button>
                    </div>
                    {/* 2行目: 曜日チェックボックス (曜日トグルがオンの時) */}
                    {hasWeekday && (
                      <div style={{ display:"flex", gap:4, padding:"0 8px 8px", flexWrap:"wrap" }}>
                        {DOW_LABELS.map((label, dow) => {
                          const active = weekdays.includes(dow);
                          return (
                            <div key={dow} onClick={()=>setBackpack(bp=>bp.map((x,j)=>{
                              if(j!==i) return x;
                              const ww = x.weekdays||[];
                              return {...x, weekdays: active ? ww.filter(d=>d!==dow) : [...ww,dow]};
                            }))}
                              style={{ width:28,height:28,borderRadius:6,display:"flex",alignItems:"center",justifyContent:"center",
                                cursor:"pointer",fontSize:11,fontWeight:600,flexShrink:0,
                                background:active?"#1d4ed8":"#0f172a",
                                color:active?"#fff":"#475569",
                                border:active?"1px solid #3b82f6":"1px solid #334155" }}>
                              {label}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div style={{ width:"100%", height:"100svh", background:"#0a0f1a",
      fontFamily:"'SF Pro Display', -apple-system, sans-serif",
      display:"flex", flexDirection:"column", overflow:"hidden", userSelect:"none" }}>
      <div style={{ flex:1, display:"flex", overflow:"hidden" }}>
        {/* Left */}
        <div style={{ width:"50%", borderRight:"1px solid #1e293b", display:"flex", flexDirection:"column", overflow:"hidden" }}>
          {renderTaskList()}
        </div>
        {/* Right timeline */}
        <div style={{ width:"50%", display:"flex", flexDirection:"column" }}>
          <div ref={timelineRef}
            onPointerDown={onTimelinePointerDown}
            onPointerMove={onTimelinePointerMove}
            onPointerUp={onTimelinePointerUp}
            style={{ flex:1, position:"relative", overflow:"hidden", background:"#0f172a", cursor:"crosshair", touchAction:"none" }}>
            {renderTicks()}
            {renderElapsed()}
            {renderNowLine()}
            {renderTaskBoxes()}
            {renderDragOverlay()}
            {/* Elapsed color picker */}
            <div style={{ position:"absolute", top:6, right:6, zIndex:20 }}>
              <button onClick={()=>setShowElapsedPicker(b=>!b)}
                style={{ width:20,height:20,borderRadius:"50%",background:elapsedColor,
                  border:"1.5px solid rgba(255,255,255,0.3)",cursor:"pointer",padding:0 }} />
              {showElapsedPicker && (
                <div style={{ position:"absolute",right:0,top:24,background:"#1e293b",
                  border:"1px solid #334155",borderRadius:8,padding:8,display:"flex",flexWrap:"wrap",gap:5,width:108,zIndex:30 }}>
                  {PALETTE.map(c=>(
                    <div key={c} onClick={()=>{setElapsedColor(c);setShowElapsedPicker(false);}}
                      style={{ width:20,height:20,borderRadius:"50%",background:c,cursor:"pointer",
                        border:elapsedColor===c?"2px solid #fff":"1px solid transparent" }} />
                  ))}
                </div>
              )}
            </div>
          </div>
          {/* Mode buttons */}
          <div style={{ padding:"6px 8px", background:"#0a0f1a", borderTop:"1px solid #1e293b", display:"flex", gap:4 }}>
            {modeLabels.map((label,i)=>(
              <button key={i} onClick={()=>setDisplayMode(i)}
                style={{ flex:1,padding:"8px 4px",borderRadius:6,fontSize:11,cursor:"pointer",
                  background:displayMode===i?"#1d4ed8":"#1e293b",
                  color:displayMode===i?"#fff":"#64748b",
                  border:displayMode===i?"1px solid #3b82f6":"1px solid #334155",
                  fontWeight:displayMode===i?600:400 }}>
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Pending range modal */}
      {pendingRange && (
        <div style={{ position:"fixed",inset:0,background:"rgba(0,0,0,0.7)",display:"flex",
          alignItems:"flex-end",justifyContent:"center",zIndex:100 }}
          onClick={()=>setPendingRange(null)}>
          <div onClick={e=>e.stopPropagation()} style={{ background:"#1e293b",borderRadius:"16px 16px 0 0",
            padding:"20px 16px 32px",width:"100%",maxWidth:400 }}>
            <div style={{ fontSize:12,color:"#94a3b8",marginBottom:4 }}>時間指定</div>
            <div style={{ fontSize:15,color:"#e2e8f0",fontWeight:600,marginBottom:16 }}>
              {formatTime(pendingRange.start)} 〜 {formatTime(pendingRange.end)} の領域をどうしますか？
            </div>
            <div style={{ display:"flex",gap:8 }}>
              <button onClick={handleZoom} style={{ flex:1,padding:12,background:"#0f172a",
                border:"1px solid #334155",borderRadius:8,color:"#60a5fa",fontSize:13,cursor:"pointer" }}>🔍 拡大</button>
              <button onClick={handleCreateTask} style={{ flex:1,padding:12,background:"#1d4ed8",
                border:"none",borderRadius:8,color:"#fff",fontSize:13,cursor:"pointer",fontWeight:600 }}>＋ タスク作成</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
