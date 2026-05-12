import { useState, useEffect, useRef, useCallback } from "react";

// ─── Constants ───────────────────────────────────────────────────────────────
const SNAP_MINUTES = 1;
const PALETTE = [
  "#EF4444","#F97316","#EAB308","#22C55E","#06B6D4",
  "#3B82F6","#8B5CF6","#EC4899","#F43F5E","#14B8A6",
];
const STORAGE_KEY = "timerapp_v1";

function loadStorage() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}; } catch { return {}; }
}
function saveStorage(data) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

// ─── Time Helpers ─────────────────────────────────────────────────────────────
function minutesOfDay(date) { return date.getHours() * 60 + date.getMinutes(); }
function formatTime(totalMinutes) {
  const h = Math.floor(((totalMinutes % 1440) + 1440) % 1440 / 60);
  const m = ((totalMinutes % 1440) + 1440) % 1440 % 60;
  return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}`;
}
function minutesToDate(baseDay, totalMinutes) {
  const d = new Date(baseDay);
  d.setHours(0, totalMinutes, 0, 0);
  return d;
}

// ─── Main App ─────────────────────────────────────────────────────────────────
export default function App() {
  const now = new Date();
  const todayBase = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const nowMin = minutesOfDay(now);

  const stored = loadStorage();

  // today string e.g. "2026-05-11"
  const todayStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}-${String(now.getDate()).padStart(2,"0")}`;

  // Display modes: 0=±12h, 1=-1h+24h, 2=custom
  const [displayMode, setDisplayMode] = useState(stored.displayMode ?? 0);
  const [customRange, setCustomRange] = useState(stored.customRange ?? null); // {start, end} in minutes-of-day
  const [tasks, setTasks] = useState(stored.tasks ?? []);
  const [backpack, setBackpack] = useState(stored.backpack ?? []);
  const [elapsedColor, setElapsedColor] = useState(stored.elapsedColor ?? "#22C55E");
  const [currentTime, setCurrentTime] = useState(nowMin);

  // UI state
  const [dragState, setDragState] = useState(null); // {startY, startMin, endMin}
  const [pendingRange, setPendingRange] = useState(null); // {start, end}
  const [editingTask, setEditingTask] = useState(null); // task id or null
  const [editDraft, setEditDraft] = useState(null);
  const [showBackpack, setShowBackpack] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState(null);
  const [taskActionId, setTaskActionId] = useState(null); // which task shows action buttons

  const timelineRef = useRef(null);

  // Persist
  useEffect(() => {
    saveStorage({ displayMode, customRange, tasks, backpack, elapsedColor });
  }, [displayMode, customRange, tasks, backpack, elapsedColor]);

  // Clock tick
  useEffect(() => {
    const id = setInterval(() => setCurrentTime(minutesOfDay(new Date())), 15000);
    return () => clearInterval(id);
  }, []);

  // Auto-place daily backpack items once per day
  useEffect(() => {
    const lastDate = stored.lastAutoPlaceDate;
    if (lastDate === todayStr) return;
    const dailyItems = backpack.filter(b => b.daily);
    if (dailyItems.length === 0) return;
    setTasks(ts => {
      let next = [...ts];
      dailyItems.forEach(template => {
        const alreadyToday = next.some(t =>
          t.name === template.name &&
          t.placedDate === todayStr
        );
        if (alreadyToday) return;
        const last = next.filter(t=>t.name===template.name).sort((a,b)=>b.end-a.end)[0];
        const dur = last ? last.end - last.start : 60;
        const startMin = last ? last.start : currentTime;
        next.push({
          ...template,
          id: Date.now().toString() + Math.random(),
          start: startMin,
          end: startMin + dur,
          placedDate: todayStr,
        });
      });
      return next;
    });
    saveStorage({ ...loadStorage(), lastAutoPlaceDate: todayStr });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Compute visible range ──────────────────────────────────────────────────
  const visibleRange = (() => {
    if (displayMode === 0) return { start: currentTime - 720, end: currentTime + 720 };
    if (displayMode === 1) return { start: currentTime - 60, end: currentTime + 1440 };
    if (displayMode === 2 && customRange) return customRange;
    return { start: currentTime - 720, end: currentTime + 720 };
  })();
  const rangeSpan = visibleRange.end - visibleRange.start;

  // ── Convert pixel ↔ minutes ───────────────────────────────────────────────
  function yToMin(y) {
    const rect = timelineRef.current?.getBoundingClientRect();
    if (!rect) return 0;
    const ratio = y / rect.height;
    return Math.round((visibleRange.start + ratio * rangeSpan) / SNAP_MINUTES) * SNAP_MINUTES;
  }
  function minToPercent(min) {
    return ((min - visibleRange.start) / rangeSpan) * 100;
  }

  // ── Touch/Mouse drag on timeline ──────────────────────────────────────────
  function onTimelinePointerDown(e) {
    if (editingTask) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const rect = timelineRef.current.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const min = yToMin(y);
    setDragState({ startMin: min, endMin: min });
  }
  function onTimelinePointerMove(e) {
    if (!dragState) return;
    const rect = timelineRef.current.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const min = yToMin(y);
    setDragState(d => ({ ...d, endMin: min }));
  }
  function onTimelinePointerUp() {
    if (!dragState) return;
    const s = Math.min(dragState.startMin, dragState.endMin);
    const en = Math.max(dragState.startMin, dragState.endMin);
    if (en - s >= 1) setPendingRange({ start: s, end: en });
    setDragState(null);
  }

  // ── Task box drag (edit mode) ─────────────────────────────────────────────
  const taskDragRef = useRef(null);

  function onTaskEdgePointerDown(e, taskId, edge) {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    taskDragRef.current = { taskId, edge };
  }
  function onTaskEdgePointerMove(e) {
    if (!taskDragRef.current) return;
    const { taskId, edge } = taskDragRef.current;
    const rect = timelineRef.current.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const min = yToMin(y);
    setTasks(ts => ts.map(t => {
      if (t.id !== taskId) return t;
      if (edge === "top") return { ...t, start: Math.min(min, t.end - 1) };
      return { ...t, end: Math.max(min, t.start + 1) };
    }));
    if (editDraft?.id === taskId) {
      setEditDraft(d => {
        if (edge === "top") return { ...d, start: Math.min(min, d.end - 1) };
        return { ...d, end: Math.max(min, d.start + 1) };
      });
    }
  }
  function onTaskEdgePointerUp() { taskDragRef.current = null; }

  // ── Pending range actions ──────────────────────────────────────────────────
  function handleZoom() {
    setCustomRange(pendingRange);
    setDisplayMode(2);
    setPendingRange(null);
  }
  function handleCreateTask() {
    const newTask = {
      id: Date.now().toString(),
      name: "新しいタスク",
      memo: "",
      color: PALETTE[tasks.length % PALETTE.length],
      start: pendingRange.start,
      end: pendingRange.end,
    };
    setTasks(ts => [...ts, newTask]);
    setPendingRange(null);
    setEditingTask(newTask.id);
    setEditDraft({ ...newTask });
  }

  // ── Edit helpers ──────────────────────────────────────────────────────────
  function openEdit(task) {
    setEditingTask(task.id);
    setEditDraft({ ...task });
    setTaskActionId(null);
  }
  function saveEdit() {
    setTasks(ts => ts.map(t => t.id === editDraft.id ? { ...editDraft } : t));
    setEditingTask(null);
    setEditDraft(null);
  }
  function cancelEdit() {
    // revert
    setTasks(ts => ts.map(t => t.id === editDraft.id ? (stored.tasks?.find(x=>x.id===t.id) || t) : t));
    setEditingTask(null);
    setEditDraft(null);
  }
  function saveToBackpack() {
    const { id: _id, start: _s, end: _e, ...template } = editDraft;
    setBackpack(bp => {
      const exists = bp.findIndex(b => b.name === template.name);
      if (exists >= 0) { const n=[...bp]; n[exists]=template; return n; }
      return [...bp, template];
    });
    saveEdit();
  }
  function deleteTask(id) {
    setTasks(ts => ts.filter(t => t.id !== id));
    setTaskActionId(null);
    if (editingTask === id) { setEditingTask(null); setEditDraft(null); }
  }
  function applyBackpack(template) {
    const last = tasks.filter(t=>t.name===template.name).sort((a,b)=>b.end-a.end)[0];
    const dur = last ? last.end - last.start : 60;
    const startMin = last ? last.start : currentTime;
    const newTask = {
      ...template,
      id: Date.now().toString(),
      start: startMin,
      end: startMin + dur,
    };
    setTasks(ts => [...ts, newTask]);
    setShowBackpack(false);
  }

  // ── Mode label ────────────────────────────────────────────────────────────
  const modeLabels = ["±12h", "-1h+24h", ...(customRange ? ["拡大"] : [])];
  const modeCount = modeLabels.length;
  function cycleMode() { setDisplayMode(m => (m + 1) % modeCount); }

  // ── Render tick marks ─────────────────────────────────────────────────────
  function renderTicks() {
    const ticks = [];
    const startH = Math.ceil(visibleRange.start / 60);
    const endH = Math.floor(visibleRange.end / 60);
    for (let h = startH; h <= endH; h++) {
      const min = h * 60;
      const pct = minToPercent(min);
      if (pct < 0 || pct > 100) continue;
      const label = `${String(((h % 24) + 24) % 24).padStart(2, "0")}:00`;
      ticks.push(
        <div key={h} style={{ position:"absolute", top:`${pct}%`, left:0, right:0, display:"flex", alignItems:"center" }}>
          <span style={{ fontSize:9, color:"#94a3b8", width:28, textAlign:"right", paddingRight:3, flexShrink:0 }}>{label}</span>
          <div style={{ flex:1, height:1, background:"rgba(148,163,184,0.3)" }} />
        </div>
      );
      // 30min tick
      const min30 = h * 60 + 30;
      const pct30 = minToPercent(min30);
      if (pct30 >= 0 && pct30 <= 100) {
        ticks.push(
          <div key={`${h}-30`} style={{ position:"absolute", top:`${pct30}%`, left:28, right:0, height:1, background:"rgba(148,163,184,0.12)" }} />
        );
      }
    }
    return ticks;
  }

  // ── Elapsed overlay ───────────────────────────────────────────────────────
  function renderElapsed() {
    const topPct = minToPercent(visibleRange.start);
    const nowPct = minToPercent(currentTime);
    const clampedTop = Math.max(0, Math.min(100, topPct < 0 ? 0 : topPct));
    const clampedNow = Math.max(0, Math.min(100, nowPct));
    if (clampedNow <= clampedTop) return null;
    return (
      <div style={{
        position:"absolute", left:28, right:0,
        top:`${clampedTop}%`, height:`${clampedNow - clampedTop}%`,
        background: elapsedColor + "33",
        borderRight: `2px solid ${elapsedColor}`,
        pointerEvents:"none",
      }} />
    );
  }

  // ── Now line ──────────────────────────────────────────────────────────────
  function renderNowLine() {
    const pct = minToPercent(currentTime);
    if (pct < 0 || pct > 100) return null;
    return (
      <div style={{ position:"absolute", top:`${pct}%`, left:28, right:0, display:"flex", alignItems:"center", zIndex:10, pointerEvents:"none" }}>
        <div style={{ width:6, height:6, borderRadius:"50%", background:"#f87171", flexShrink:0 }} />
        <div style={{ flex:1, height:2, background:"#f87171" }} />
        <span style={{ fontSize:9, color:"#f87171", paddingLeft:2 }}>{formatTime(currentTime)}</span>
      </div>
    );
  }

  // ── Task boxes ────────────────────────────────────────────────────────────
  function renderTaskBoxes() {
    return tasks.map(task => {
      const isEditing = editingTask === task.id;
      const displayTask = isEditing ? editDraft : task;
      const topPct = minToPercent(displayTask.start);
      const btmPct = minToPercent(displayTask.end);
      const heightPct = btmPct - topPct;
      if (btmPct < 0 || topPct > 100) return null;
      const isSelected = taskActionId === task.id;
      return (
        <div
          key={task.id}
          onPointerDown={e => { if (!isEditing) { e.stopPropagation(); setTaskActionId(isSelected ? null : task.id); }}}
          onPointerMove={isEditing ? onTaskEdgePointerMove : undefined}
          onPointerUp={isEditing ? onTaskEdgePointerUp : undefined}
          style={{
            position:"absolute", left:30, right:2,
            top:`${Math.max(0, topPct)}%`,
            height:`${Math.min(heightPct, 100 - Math.max(0,topPct))}%`,
            minHeight:8,
            background: displayTask.color + "55",
            border: `1.5px solid ${displayTask.color}`,
            borderRadius:4,
            zIndex: isEditing ? 20 : 5,
            cursor: isEditing ? "default" : "pointer",
            overflow:"hidden",
          }}
        >
          <span style={{ fontSize:9, color:"#e2e8f0", paddingLeft:3, paddingTop:1, display:"block", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>
            {displayTask.name}
          </span>
          {isEditing && (
            <>
              <div
                onPointerDown={e => onTaskEdgePointerDown(e, task.id, "top")}
                style={{ position:"absolute", top:0, left:0, right:0, height:12, cursor:"ns-resize", background:"rgba(255,255,255,0.2)", display:"flex", justifyContent:"center", alignItems:"center" }}
              >
                <div style={{ width:20, height:2, background:"rgba(255,255,255,0.7)", borderRadius:1 }} />
              </div>
              <div
                onPointerDown={e => onTaskEdgePointerDown(e, task.id, "bottom")}
                style={{ position:"absolute", bottom:0, left:0, right:0, height:12, cursor:"ns-resize", background:"rgba(255,255,255,0.2)", display:"flex", justifyContent:"center", alignItems:"center" }}
              >
                <div style={{ width:20, height:2, background:"rgba(255,255,255,0.7)", borderRadius:1 }} />
              </div>
            </>
          )}
          {isSelected && !isEditing && (
            <div style={{ position:"absolute", right:2, top:2, display:"flex", gap:3, zIndex:30 }}>
              <button onClick={e=>{e.stopPropagation();openEdit(task);}} style={miniBtn("#3b82f6")}>編集</button>
              <button onClick={e=>{e.stopPropagation();saveToBackpackFromTask(task);}} style={miniBtn("#8b5cf6")}>保存</button>
              <button onClick={e=>{e.stopPropagation();deleteTask(task.id);}} style={miniBtn("#ef4444")}>削除</button>
            </div>
          )}
        </div>
      );
    });
  }

  function saveToBackpackFromTask(task) {
    const { id:_,start:_s,end:_e,...template } = task;
    setBackpack(bp => {
      const exists = bp.findIndex(b=>b.name===template.name);
      if (exists>=0){const n=[...bp];n[exists]=template;return n;}
      return [...bp,template];
    });
    setTaskActionId(null);
  }

  function miniBtn(bg) {
    return { background:bg, border:"none", borderRadius:3, color:"#fff", fontSize:8, padding:"2px 4px", cursor:"pointer" };
  }

  // ── Drag selection overlay ─────────────────────────────────────────────────
  function renderDragOverlay() {
    if (!dragState) return null;
    const s = minToPercent(Math.min(dragState.startMin, dragState.endMin));
    const e = minToPercent(Math.max(dragState.startMin, dragState.endMin));
    return (
      <div style={{
        position:"absolute", left:30, right:2,
        top:`${Math.max(0,s)}%`, height:`${e-s}%`,
        background:"rgba(148,163,184,0.25)",
        border:"1px dashed #94a3b8",
        pointerEvents:"none", zIndex:15,
      }}>
        <span style={{ position:"absolute", bottom:-14, left:0, fontSize:9, color:"#94a3b8", whiteSpace:"nowrap" }}>
          {formatTime(Math.min(dragState.startMin,dragState.endMin))}〜{formatTime(Math.max(dragState.startMin,dragState.endMin))}
        </span>
      </div>
    );
  }

  // ── Edit panel (left side when editing) ───────────────────────────────────
  function renderEditPanel() {
    if (!editingTask || !editDraft) return renderTaskList();
    return (
      <div style={{ padding:"12px 10px", display:"flex", flexDirection:"column", gap:10, height:"100%", overflowY:"auto" }}>
        <div style={{ fontSize:11, color:"#94a3b8", fontWeight:600, letterSpacing:1 }}>タスク編集</div>
        <label style={labelStyle}>タスク名
          <input value={editDraft.name} onChange={e=>setEditDraft(d=>({...d,name:e.target.value}))} style={inputStyle} />
        </label>
        <label style={labelStyle}>メモ
          <textarea value={editDraft.memo} onChange={e=>setEditDraft(d=>({...d,memo:e.target.value}))} rows={3} style={{...inputStyle,resize:"none"}} />
        </label>
        <div style={{ display:"flex", gap:8 }}>
          <label style={{...labelStyle,flex:1}}>開始
            <input type="time" value={`${String(Math.floor(((editDraft.start%1440)+1440)%1440/60)).padStart(2,"0")}:${String(((editDraft.start%1440)+1440)%1440%60).padStart(2,"0")}`}
              onChange={e=>{const [h,m]=e.target.value.split(":").map(Number);const newStart=h*60+m;setEditDraft(d=>({...d,start:newStart}));setTasks(ts=>ts.map(t=>t.id===editDraft.id?{...t,start:newStart}:t));}}
              style={inputStyle} />
          </label>
          <label style={{...labelStyle,flex:1}}>終了
            <input type="time" value={`${String(Math.floor(((editDraft.end%1440)+1440)%1440/60)).padStart(2,"0")}:${String(((editDraft.end%1440)+1440)%1440%60).padStart(2,"0")}`}
              onChange={e=>{const [h,m]=e.target.value.split(":").map(Number);const newEnd=h*60+m;setEditDraft(d=>({...d,end:newEnd}));setTasks(ts=>ts.map(t=>t.id===editDraft.id?{...t,end:newEnd}:t));}}
              style={inputStyle} />
          </label>
        </div>
        <div style={labelStyle}>色
          <div style={{ display:"flex", flexWrap:"wrap", gap:6, marginTop:4 }}>
            {PALETTE.map(c=>(
              <div key={c} onClick={()=>setEditDraft(d=>({...d,color:c}))}
                style={{ width:22,height:22,borderRadius:"50%",background:c,cursor:"pointer",
                  border: editDraft.color===c?"2px solid #fff":"2px solid transparent",
                  boxShadow: editDraft.color===c?"0 0 0 1px #fff":"none" }} />
            ))}
          </div>
        </div>
        <div style={{ display:"flex", gap:6, marginTop:"auto" }}>
          <button onClick={saveEdit} style={{ flex:1,...actionBtn("#22c55e") }}>✓ 保存</button>
          <button onClick={saveToBackpack} style={{ flex:1,...actionBtn("#8b5cf6") }}>📦 バックパック</button>
          <button onClick={cancelEdit} style={{ flex:1,...actionBtn("#475569") }}>✕</button>
        </div>
      </div>
    );
  }

  function renderTaskList() {
    return (
      <div style={{ display:"flex", flexDirection:"column", height:"100%", overflow:"hidden" }}>
        <div style={{ padding:"12px 10px 6px", fontSize:11, color:"#94a3b8", fontWeight:600, letterSpacing:1 }}>タスク一覧</div>
        <div style={{ flex:1, overflowY:"auto", padding:"0 8px" }}>
          {tasks.length === 0 && <div style={{ fontSize:11, color:"#475569", padding:"8px 2px" }}>タスクがありません</div>}
          {tasks.map(task => (
            <div key={task.id}
              onClick={()=>setTaskActionId(taskActionId===task.id?null:task.id)}
              style={{ display:"flex", flexDirection:"column", padding:"8px 8px", marginBottom:6, borderRadius:6,
                background:"#1e293b", borderLeft:`3px solid ${task.color}`, cursor:"pointer" }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                <span style={{ fontSize:12, color:"#e2e8f0", fontWeight:500 }}>{task.name}</span>
                <span style={{ fontSize:9, color:"#64748b" }}>{formatTime(task.start)}〜{formatTime(task.end)}</span>
              </div>
              {task.memo && <span style={{ fontSize:10, color:"#64748b", marginTop:2 }}>{task.memo}</span>}
              {taskActionId === task.id && (
                <div style={{ display:"flex", gap:4, marginTop:6 }}>
                  <button onClick={e=>{e.stopPropagation();openEdit(task);}} style={actionBtn("#3b82f6")}>編集</button>
                  <button onClick={e=>{e.stopPropagation();saveToBackpackFromTask(task);}} style={actionBtn("#8b5cf6")}>保存</button>
                  <button onClick={e=>{e.stopPropagation();deleteTask(task.id);}} style={actionBtn("#ef4444")}>削除</button>
                </div>
              )}
            </div>
          ))}
        </div>
        <div style={{ padding:"8px", borderTop:"1px solid #1e293b" }}>
          <button onClick={()=>setShowBackpack(b=>!b)}
            style={{ width:"100%", padding:"8px", background:"#1e293b", border:"1px solid #334155",
              borderRadius:6, color:"#94a3b8", fontSize:11, cursor:"pointer" }}>
            📦 バックパック {backpack.length > 0 ? `(${backpack.length})` : ""}
          </button>
          {showBackpack && (
            <div style={{ marginTop:6, maxHeight:200, overflowY:"auto" }}>
              {backpack.length===0 && <div style={{fontSize:10,color:"#475569",padding:4}}>保存なし</div>}
              {backpack.map((b,i)=>(
                <div key={i}
                  style={{ display:"flex", alignItems:"center", gap:6, padding:"6px 8px", marginBottom:4,
                    background:"#0f172a", borderRadius:4, borderLeft:`3px solid ${b.color}` }}>
                  <span onClick={()=>applyBackpack(b)} style={{ fontSize:11, color:"#e2e8f0", flex:1, cursor:"pointer" }}>{b.name}</span>
                  {/* daily toggle */}
                  <div onClick={e=>{
                    e.stopPropagation();
                    setBackpack(bp=>bp.map((x,j)=>j===i?{...x,daily:!x.daily}:x));
                  }} style={{
                    display:"flex", alignItems:"center", gap:3, cursor:"pointer",
                    padding:"2px 5px", borderRadius:10,
                    background: b.daily ? "#166534" : "#1e293b",
                    border: b.daily ? "1px solid #22c55e" : "1px solid #334155",
                  }}>
                    <div style={{
                      width:8, height:8, borderRadius:"50%",
                      background: b.daily ? "#22c55e" : "#475569",
                      transition:"background 0.2s",
                    }}/>
                    <span style={{ fontSize:8, color: b.daily ? "#22c55e" : "#475569", whiteSpace:"nowrap" }}>毎日</span>
                  </div>
                  <span onClick={()=>applyBackpack(b)} style={{ fontSize:9, color:"#64748b", cursor:"pointer" }}>適用</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  const labelStyle = { display:"flex", flexDirection:"column", gap:3, fontSize:10, color:"#94a3b8" };
  const inputStyle = { background:"#0f172a", border:"1px solid #334155", borderRadius:4, color:"#e2e8f0", fontSize:12, padding:"6px 8px", outline:"none" };
  function actionBtn(bg) {
    return { background:bg+"22", border:`1px solid ${bg}`, borderRadius:4, color:bg, fontSize:10, padding:"5px 8px", cursor:"pointer" };
  }

  // ── Elapsed color picker ──────────────────────────────────────────────────
  const [showElapsedPicker, setShowElapsedPicker] = useState(false);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={{
      width:"100%", height:"100svh", background:"#0a0f1a",
      fontFamily:"'SF Pro Display', -apple-system, sans-serif",
      display:"flex", flexDirection:"column", overflow:"hidden", userSelect:"none",
    }}>
      {/* Main area */}
      <div style={{ flex:1, display:"flex", overflow:"hidden" }}>
        {/* Left panel */}
        <div style={{ width:"50%", borderRight:"1px solid #1e293b", display:"flex", flexDirection:"column", overflow:"hidden" }}>
          {renderEditPanel()}
        </div>

        {/* Right timeline */}
        <div style={{ width:"50%", display:"flex", flexDirection:"column" }}>
          <div
            ref={timelineRef}
            onPointerDown={onTimelinePointerDown}
            onPointerMove={e=>{onTimelinePointerMove(e);if(taskDragRef.current)onTaskEdgePointerMove(e);}}
            onPointerUp={e=>{onTimelinePointerUp();if(taskDragRef.current)onTaskEdgePointerUp();}}
            style={{
              flex:1, position:"relative", overflow:"hidden",
              background:"#0f172a", cursor:"crosshair",
              touchAction:"none",
            }}
          >
            {renderTicks()}
            {renderElapsed()}
            {renderNowLine()}
            {renderTaskBoxes()}
            {renderDragOverlay()}

            {/* Elapsed color button */}
            <div style={{ position:"absolute", top:6, right:6, zIndex:20 }}>
              <button onClick={()=>setShowElapsedPicker(b=>!b)}
                style={{ width:18, height:18, borderRadius:"50%", background:elapsedColor,
                  border:"1.5px solid rgba(255,255,255,0.3)", cursor:"pointer", padding:0 }} />
              {showElapsedPicker && (
                <div style={{ position:"absolute", right:0, top:22, background:"#1e293b",
                  border:"1px solid #334155", borderRadius:8, padding:8, display:"flex", flexWrap:"wrap", gap:5, width:100, zIndex:30 }}>
                  {PALETTE.map(c=>(
                    <div key={c} onClick={()=>{setElapsedColor(c);setShowElapsedPicker(false);}}
                      style={{ width:18,height:18,borderRadius:"50%",background:c,cursor:"pointer",
                        border:elapsedColor===c?"2px solid #fff":"1px solid transparent" }} />
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Mode button */}
          <div style={{ padding:"6px 8px", background:"#0a0f1a", borderTop:"1px solid #1e293b", display:"flex", gap:4 }}>
            {modeLabels.map((label, i) => (
              <button key={i} onClick={()=>setDisplayMode(i)}
                style={{
                  flex:1, padding:"7px 4px", borderRadius:6, fontSize:10, cursor:"pointer",
                  background: displayMode===i?"#1d4ed8":"#1e293b",
                  color: displayMode===i?"#fff":"#64748b",
                  border: displayMode===i?"1px solid #3b82f6":"1px solid #334155",
                  fontWeight: displayMode===i?600:400,
                }}>
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Pending range modal */}
      {pendingRange && (
        <div style={{
          position:"fixed", inset:0, background:"rgba(0,0,0,0.7)", display:"flex",
          alignItems:"flex-end", justifyContent:"center", zIndex:100,
        }} onClick={()=>setPendingRange(null)}>
          <div onClick={e=>e.stopPropagation()} style={{
            background:"#1e293b", borderRadius:"16px 16px 0 0", padding:"20px 16px 32px",
            width:"100%", maxWidth:400,
          }}>
            <div style={{ fontSize:12, color:"#94a3b8", marginBottom:4 }}>時間指定</div>
            <div style={{ fontSize:15, color:"#e2e8f0", fontWeight:600, marginBottom:16 }}>
              {formatTime(pendingRange.start)} 〜 {formatTime(pendingRange.end)} の領域をどうしますか？
            </div>
            <div style={{ display:"flex", gap:8 }}>
              <button onClick={handleZoom} style={{ flex:1, padding:12, background:"#0f172a", border:"1px solid #334155",
                borderRadius:8, color:"#60a5fa", fontSize:13, cursor:"pointer" }}>🔍 拡大</button>
              <button onClick={handleCreateTask} style={{ flex:1, padding:12, background:"#1d4ed8",
                border:"none", borderRadius:8, color:"#fff", fontSize:13, cursor:"pointer", fontWeight:600 }}>＋ タスク作成</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
