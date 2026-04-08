import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";

const DEFAULT_PAGE_TITLE = "YOUR TO DO LIST";

/** Short name for headings / tab title (e.g. CINDY from cindy@x.com or user_metadata). */
function brandNameFromUser(u: User): string {
  const meta = u.user_metadata as Record<string, unknown> | undefined;
  const fromMeta = meta?.full_name ?? meta?.name ?? meta?.preferred_username ?? meta?.user_name;
  if (typeof fromMeta === "string" && fromMeta.trim()) {
    const first = fromMeta.trim().split(/\s+/)[0] ?? fromMeta.trim();
    return first.toUpperCase();
  }
  const email = u.email;
  if (email) {
    const local = email.split("@")[0] ?? "";
    const chunk = local.split(/[._\-+]/)[0] ?? local;
    const alnum = chunk.replace(/[^a-zA-Z0-9]/g, "");
    if (alnum.length > 0) return alnum.toUpperCase();
  }
  return "YOUR";
}
import "./App.css";
import { playPencilDoneSound, primeTaskDoneAudio } from "./playPencilSound";
import { supabase, supabaseConfigured } from "./supabaseClient";

/** Categories the user can assign (pills). Not stored: "time-sensitive" — that tab uses due dates. */
export type AssignableCategoryId =
  | "house-chores"
  | "career"
  | "health"
  | "side-quests"
  | "misc";

/** Category tabs including the due-date–driven Time-Sensitive tab. */
export type CategoryTabId = AssignableCategoryId | "time-sensitive";

export type TabId = "everything" | "today" | CategoryTabId;

const ASSIGNABLE_CATEGORY_ORDER: AssignableCategoryId[] = [
  "house-chores",
  "career",
  "health",
  "side-quests",
  "misc",
];

const CATEGORY_TAB_ORDER: CategoryTabId[] = ["time-sensitive", ...ASSIGNABLE_CATEGORY_ORDER];

const CATEGORY_LABEL: Record<CategoryTabId, string> = {
  "time-sensitive": "Time-Sensitive",
  "house-chores": "House",
  career: "Career",
  health: "Health",
  "side-quests": "Side Quests",
  misc: "Misc",
};

type TodoRow = {
  id: string;
  title: string;
  categories: AssignableCategoryId[];
  notes: string | null;
  due_date: string | null;
  for_today: boolean;
  completed_at: string | null;
  sort_key: number;
};

function localDateString(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseCategories(raw: unknown): AssignableCategoryId[] {
  if (!Array.isArray(raw)) return [];
  const set = new Set(ASSIGNABLE_CATEGORY_ORDER);
  return raw.filter(
    (c): c is AssignableCategoryId => typeof c === "string" && set.has(c as AssignableCategoryId)
  );
}

const REMOVE_ANIMATION_MS = 600;

function EditPencilIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={18}
      height={18}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={18}
      height={18}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M3 6h18" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <path d="M10 11v6M14 11v6" />
    </svg>
  );
}

function TodoRemoveParticles() {
  const bits = useMemo(
    () =>
      Array.from({ length: 22 }, (_, i) => {
        const angle = (i / 22) * Math.PI * 2 + 0.35;
        const dist = 32 + (i % 8) * 7;
        const tx = Math.round(Math.cos(angle) * dist * 10) / 10;
        const ty = Math.round(Math.sin(angle) * dist * 10) / 10;
        return {
          tx,
          ty,
          delay: `${(i % 6) * 0.02}s`,
          bg: ["#2a2a2a", "#4a4a48", "#6b5c4c", "#333"][i % 4],
        };
      }),
    []
  );
  return (
    <span className="todo-remove-particles" aria-hidden>
      {bits.map((b, i) => (
        <span
          key={i}
          className="todo-remove-particle"
          style={
            {
              "--tx": `${b.tx}px`,
              "--ty": `${b.ty}px`,
              animationDelay: b.delay,
              backgroundColor: b.bg,
            } as React.CSSProperties
          }
        />
      ))}
    </span>
  );
}

function linkify(text: string): ReactNode[] {
  const url = /(https?:\/\/[^\s<]+[^<.,:;"')\]\s])/gi;
  const parts: ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  const re = new RegExp(url.source, "gi");
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) {
      parts.push(text.slice(last, m.index));
    }
    const href = m[0];
    parts.push(
      <a key={key++} href={href} target="_blank" rel="noreferrer noopener">
        {href}
      </a>
    );
    last = m.index + href.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts.length ? parts : [text];
}

function isTodoOverdue(todo: TodoRow): boolean {
  if (todo.completed_at || !todo.due_date) return false;
  return todo.due_date < localDateString();
}

function sortTodosForView(list: TodoRow[]): TodoRow[] {
  const inc = list.filter((t) => !t.completed_at);
  const overdue = inc
    .filter((t) => isTodoOverdue(t))
    .sort((a, b) => {
      const da = a.due_date!;
      const db = b.due_date!;
      if (da < db) return -1;
      if (da > db) return 1;
      return a.sort_key - b.sort_key;
    });
  const notOverdue = inc.filter((t) => !isTodoOverdue(t)).sort((a, b) => a.sort_key - b.sort_key);
  const done = list
    .filter((t) => t.completed_at)
    .sort((a, b) => {
      const ta = new Date(a.completed_at!).getTime();
      const tb = new Date(b.completed_at!).getTime();
      return ta - tb;
    });
  return [...overdue, ...notOverdue, ...done];
}

function filterByTab(list: TodoRow[], tab: TabId): TodoRow[] {
  const today = localDateString();
  if (tab === "everything") return list;
  if (tab === "today") {
    return list.filter((t) => t.for_today || t.due_date === today);
  }
  if (tab === "time-sensitive") {
    return list.filter((t) => Boolean(t.due_date));
  }
  return list.filter((t) => t.categories.includes(tab));
}

function completedTodayCount(list: TodoRow[]): number {
  const today = localDateString();
  return list.filter((t) => {
    if (!t.completed_at) return false;
    return localDateString(new Date(t.completed_at)) === today;
  }).length;
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [email, setEmail] = useState("");
  const [authMsg, setAuthMsg] = useState<string | null>(null);
  const [authErr, setAuthErr] = useState<string | null>(null);
  const [authEmptyFieldTipPos, setAuthEmptyFieldTipPos] = useState<{ x: number; y: number } | null>(
    null
  );
  const authSubmitBtnRef = useRef<HTMLButtonElement>(null);

  const [todos, setTodos] = useState<TodoRow[]>([]);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [tab, setTab] = useState<TabId>("everything");

  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [due, setDue] = useState("");
  const [forToday, setForToday] = useState(false);
  const [selectedCats, setSelectedCats] = useState<Set<AssignableCategoryId>>(new Set());
  const [addDisabledTipPos, setAddDisabledTipPos] = useState<{ x: number; y: number } | null>(null);

  const [strikingId, setStrikingId] = useState<string | null>(null);
  const strikeHandledRef = useRef<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [editDue, setEditDue] = useState("");
  const [editForToday, setEditForToday] = useState(false);
  const [editCats, setEditCats] = useState<Set<AssignableCategoryId>>(new Set());
  const [editSaving, setEditSaving] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const user = session?.user ?? null;

  const refreshTodos = useCallback(async (u: User) => {
    if (!supabase) return;
    setLoadErr(null);
    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    await supabase.from("todos").delete().lt("completed_at", cutoff).not("completed_at", "is", null);

    const { data, error } = await supabase
      .from("todos")
      .select("id,title,categories,notes,due_date,for_today,completed_at,sort_key")
      .eq("user_id", u.id)
      .order("sort_key", { ascending: true });

    if (error) {
      setLoadErr(error.message);
      return;
    }
    const mapped: TodoRow[] = (data ?? []).map((row) => ({
      id: row.id as string,
      title: row.title as string,
      categories: parseCategories(row.categories),
      notes: (row.notes as string | null) ?? null,
      due_date: (row.due_date as string | null) ?? null,
      for_today: Boolean(row.for_today),
      completed_at: (row.completed_at as string | null) ?? null,
      sort_key: Number(row.sort_key),
    }));
    setTodos(mapped);
  }, []);

  useEffect(() => {
    if (!supabaseConfigured || !supabase) {
      setAuthReady(true);
      return;
    }
    let cancelled = false;
    supabase.auth.getSession().then(({ data }) => {
      if (!cancelled) {
        setSession(data.session);
        setAuthReady(true);
      }
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
    });
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    setEditingId(null);
    setEditSaving(false);
  }, [tab]);

  useEffect(() => {
    if (!supabase || !user) return;
    const client = supabase;
    void refreshTodos(user);
    const ch = client
      .channel(`todos-${user.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "todos", filter: `user_id=eq.${user.id}` },
        () => {
          void refreshTodos(user);
        }
      )
      .subscribe();
    return () => {
      void client.removeChannel(ch);
    };
  }, [user, refreshTodos]);

  useEffect(() => {
    if (!user) {
      document.title = DEFAULT_PAGE_TITLE;
      return;
    }
    document.title = `${brandNameFromUser(user)}'s to do list`;
  }, [user]);

  const visibleTodos = useMemo(
    () => sortTodosForView(filterByTab(todos, tab)),
    [todos, tab]
  );

  const todayCompleted = useMemo(() => completedTodayCount(todos), [todos]);

  const toggleCat = (id: AssignableCategoryId) => {
    setSelectedCats((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleEditCat = (id: AssignableCategoryId) => {
    setEditCats((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const startEdit = (todo: TodoRow) => {
    if (todo.completed_at) return;
    setStrikingId(null);
    setEditingId(todo.id);
    setEditTitle(todo.title);
    setEditNotes(todo.notes ?? "");
    setEditDue(todo.due_date ?? "");
    setEditForToday(todo.for_today);
    setEditCats(new Set(todo.categories));
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditSaving(false);
  };

  const saveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supabase || !user || !editingId) return;
    const t = editTitle.trim();
    if (!t || editCats.size === 0) return;
    setEditSaving(true);
    const cats = ASSIGNABLE_CATEGORY_ORDER.filter((c) => editCats.has(c));
    const { error } = await supabase
      .from("todos")
      .update({
        title: t,
        categories: cats,
        notes: editNotes.trim() || null,
        due_date: editDue || null,
        for_today: editForToday,
      })
      .eq("id", editingId);
    setEditSaving(false);
    if (error) {
      setLoadErr(error.message);
      return;
    }
    cancelEdit();
    void refreshTodos(user);
  };

  const sendMagicLink = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supabase) return;
    setAuthMsg(null);
    setAuthErr(null);
    if (!email.trim()) {
      const btn = authSubmitBtnRef.current;
      if (btn) {
        const r = btn.getBoundingClientRect();
        setAuthEmptyFieldTipPos({ x: r.left + r.width / 2, y: r.bottom + 10 });
      } else {
        setAuthEmptyFieldTipPos({ x: window.innerWidth / 2, y: 120 });
      }
      return;
    }
    setAuthEmptyFieldTipPos(null);
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: window.location.origin },
    });
    if (error) setAuthErr(error.message);
    else setAuthMsg("Check your email for the sign in link!");
  };

  const signOut = async () => {
    if (!supabase) return;
    await supabase.auth.signOut();
  };

  const addTodo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supabase || !user) return;
    const t = title.trim();
    if (!t || selectedCats.size === 0) return;
    const cats = ASSIGNABLE_CATEGORY_ORDER.filter((c) => selectedCats.has(c));
    const row = {
      user_id: user.id,
      title: t,
      categories: cats,
      notes: notes.trim() || null,
      due_date: due || null,
      for_today: forToday,
      sort_key: Date.now(),
    };
    const { error } = await supabase.from("todos").insert(row);
    if (error) {
      setLoadErr(error.message);
      return;
    }
    setTitle("");
    setNotes("");
    setDue("");
    setForToday(false);
    void refreshTodos(user);
  };

  const completeAfterStrike = async (id: string) => {
    if (!supabase || !user) return;
    const completedAt = new Date().toISOString();
    const { error } = await supabase.from("todos").update({ completed_at: completedAt }).eq("id", id);
    setStrikingId(null);
    if (error) {
      setLoadErr(error.message);
      await refreshTodos(user);
      return;
    }
    setTodos((prev) =>
      prev.map((x) => (x.id === id ? { ...x, completed_at: completedAt } : x))
    );
    playPencilDoneSound();
  };

  const onCheckStart = (todo: TodoRow) => {
    if (todo.completed_at || strikingId) return;
    primeTaskDoneAudio();
    setStrikingId(todo.id);
  };

  const onStrikeEnd = (id: string) => {
    if (strikingId !== id) return;
    if (strikeHandledRef.current === id) return;
    strikeHandledRef.current = id;
    void completeAfterStrike(id).finally(() => {
      if (strikeHandledRef.current === id) strikeHandledRef.current = null;
    });
  };

  const toggleTodoForToday = async (todo: TodoRow) => {
    if (!supabase || !user || todo.completed_at || editingId === todo.id) return;
    const next = !todo.for_today;
    const { error } = await supabase.from("todos").update({ for_today: next }).eq("id", todo.id);
    if (error) {
      setLoadErr(error.message);
      return;
    }
    setTodos((prev) => prev.map((x) => (x.id === todo.id ? { ...x, for_today: next } : x)));
  };

  const startRemoveTodo = useCallback(
    (todo: TodoRow) => {
      if (!supabase || !user || removingId || strikingId === todo.id) return;
      const client = supabase;
      const id = todo.id;
      setRemovingId(id);
      window.setTimeout(async () => {
        setRemovingId((cur) => (cur === id ? null : cur));
        const { error } = await client.from("todos").delete().eq("id", id);
        if (error) {
          setLoadErr(error.message);
          await refreshTodos(user);
          return;
        }
        setTodos((prev) => prev.filter((x) => x.id !== id));
        setEditingId((e) => (e === id ? null : e));
        setEditSaving(false);
      }, REMOVE_ANIMATION_MS);
    },
    [supabase, user, removingId, strikingId, refreshTodos]
  );

  if (!supabaseConfigured) {
    return (
      <div className="app">
        <div className="setup-banner">
          <strong>Supabase is not configured.</strong> Create a project at{" "}
          <a href="https://supabase.com/dashboard">supabase.com</a>, run the SQL in{" "}
          <code>supabase/migrations/001_todos.sql</code>, enable Realtime for <code>todos</code>, then add{" "}
          <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> to <code>.env</code> (see{" "}
          <code>.env.example</code>).
        </div>
      </div>
    );
  }

  if (!authReady) {
    return (
      <div className="app">
        <p className="list-empty">Loading…</p>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="app app--signin">
        <form className="auth-panel" onSubmit={sendMagicLink}>
          <img
            className="auth-hello-banner"
            src="/auth-hello.png"
            alt="Hello"
            width={673}
            height={633}
            decoding="async"
          />
          <img
            className="auth-brand-banner"
            src="/auth-your-to-do-list.png"
            alt="YOUR TO DO LIST"
            width={2195}
            height={296}
            decoding="async"
          />
          <p>Sign in with your email. We&apos;ll send a magic link so your list syncs on every device.</p>
          <input
            type="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setAuthEmptyFieldTipPos(null);
            }}
            autoComplete="email"
          />
          <button ref={authSubmitBtnRef} type="submit" className="btn-add">
            Send magic link
          </button>
          {authEmptyFieldTipPos ? (
            <div
              className="add-disabled-cursor-tip auth-empty-field-tip"
              style={{
                left: authEmptyFieldTipPos.x,
                top: authEmptyFieldTipPos.y,
              }}
              role="alert"
            >
              Please enter an email address
            </div>
          ) : null}
          {authMsg ? <p className="auth-msg">{authMsg}</p> : null}
          {authErr ? <p className="auth-err">{authErr}</p> : null}
        </form>
      </div>
    );
  }

  const canAdd = title.trim().length > 0 && selectedCats.size > 0;

  return (
    <div className="app">
      <div className="top-bar">
        <aside className="head-sidebar">
          <header className="brand-head">
            <h1 className="brand-name-heading">{brandNameFromUser(user)}&apos;S</h1>
            <img
              className="brand-header-graphic"
              src="/header-todo-list.png"
              alt="To do list"
              decoding="async"
              fetchPriority="high"
            />
          </header>
          <p className="brand-sub">All the life admin I need to do compiled in one place, organised the way I want it :) </p>
          <div className="user-row">
            <span className="user-email">{user.email}</span>
            <button type="button" className="sign-out" onClick={() => void signOut()}>
              Sign out
            </button>
          </div>
          <div className="stat-tile stat-tile-below-email" aria-live="polite">
            <div className="stat-tile-inner">
              <p className="stat-tile-line">
                {todayCompleted}{" "}
                {todayCompleted === 1 ? "task" : "tasks"} completed today
              </p>
              <img
                className="stat-tile-pencil"
                src="/stat-pencil.png"
                alt=""
                width={72}
                height={63}
                decoding="async"
              />
            </div>
          </div>
        </aside>
        <form className="input-card input-card-bar new-task-panel" onSubmit={addTodo}>
          <label className="field-label" htmlFor="task-title">
            New task
          </label>
          <input
            id="task-title"
            className="task-input"
            type="text"
            placeholder="Write to-do list item here.."
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            autoComplete="off"
          />
          <span className="field-label">Categories</span>
          <div className="pills-row">
            {ASSIGNABLE_CATEGORY_ORDER.map((id) => (
              <button
                key={id}
                type="button"
                className={`pill ${id} ${selectedCats.has(id) ? "selected" : ""}`}
                onClick={() => toggleCat(id)}
              >
                {CATEGORY_LABEL[id]}
              </button>
            ))}
          </div>
          <label className="field-label" htmlFor="task-notes">
            Notes (optional)
          </label>
          <textarea
            id="task-notes"
            rows={1}
            placeholder="URLs or reminders…"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
          <div className="row-due-today row-due-with-add">
            <div className="row-due-fields">
              <label>
                <span>Due date</span>
                <input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={forToday}
                  onChange={(e) => setForToday(e.target.checked)}
                />
                Mark for today
              </label>
            </div>
            <span
              className="add-to-list-wrap"
              onMouseEnter={(e) => {
                if (!canAdd) setAddDisabledTipPos({ x: e.clientX, y: e.clientY });
              }}
              onMouseMove={(e) => {
                if (canAdd) {
                  setAddDisabledTipPos(null);
                  return;
                }
                setAddDisabledTipPos({ x: e.clientX, y: e.clientY });
              }}
              onMouseLeave={() => setAddDisabledTipPos(null)}
            >
              <button type="submit" className="btn-add btn-add-inline" disabled={!canAdd}>
                Add to list
              </button>
            </span>
          </div>
          {addDisabledTipPos && !canAdd ? (
            <div
              className="add-disabled-cursor-tip"
              style={{ left: addDisabledTipPos.x + 14, top: addDisabledTipPos.y + 14 }}
              role="status"
            >
              Fill in the fields!
            </div>
          ) : null}
        </form>
      </div>

      {loadErr ? (
        <div className="setup-banner" style={{ background: "#ffecec", borderColor: "#e6a8a8" }}>
          {loadErr}
        </div>
      ) : null}

      <div className="list-shell">
        <div className="tabs" role="tablist">
          <button
            type="button"
            role="tab"
            className={`tab everything ${tab === "everything" ? "active" : ""}`}
            onClick={() => setTab("everything")}
          >
            Everything
          </button>
          <button
            type="button"
            role="tab"
            className={`tab today ${tab === "today" ? "active" : ""}`}
            onClick={() => setTab("today")}
          >
            Today
          </button>
          {CATEGORY_TAB_ORDER.map((id) => (
            <button
              key={id}
              type="button"
              role="tab"
              className={`tab ${id} ${tab === id ? "active" : ""}`}
              onClick={() => setTab(id)}
            >
              {CATEGORY_LABEL[id]}
            </button>
          ))}
        </div>
        <div className="list-panel">
          {visibleTodos.length === 0 ? (
            <div className="list-empty-state" role="status" aria-live="polite">
              <img
                className="list-empty-image"
                src="/empty-state.png"
                alt="Nothing here yet"
                width={2388}
                height={1668}
                decoding="async"
              />
            </div>
          ) : (
            visibleTodos.map((todo) => (
              <article
                key={todo.id}
                className={[
                  "todo-item",
                  editingId === todo.id ? "todo-item--editing" : "",
                  removingId === todo.id ? "todo-item--removing" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
              >
                {removingId === todo.id ? <TodoRemoveParticles /> : null}
                <input
                  type="checkbox"
                  className="todo-check"
                  checked={Boolean(todo.completed_at) || strikingId === todo.id}
                  disabled={
                    Boolean(todo.completed_at) ||
                    strikingId === todo.id ||
                    editingId === todo.id ||
                    removingId === todo.id
                  }
                  onChange={() => onCheckStart(todo)}
                />
                <div className="todo-body">
                  {editingId === todo.id ? (
                    <form className="todo-edit-form" onSubmit={(e) => void saveEdit(e)}>
                      <input
                        className="todo-edit-title"
                        type="text"
                        value={editTitle}
                        onChange={(e) => setEditTitle(e.target.value)}
                        aria-label="Task title"
                      />
                      <span className="todo-edit-label">Categories</span>
                      <div className="pills-row todo-edit-pills">
                        {ASSIGNABLE_CATEGORY_ORDER.map((id) => (
                          <button
                            key={id}
                            type="button"
                            className={`pill ${id} ${editCats.has(id) ? "selected" : ""}`}
                            onClick={() => toggleEditCat(id)}
                          >
                            {CATEGORY_LABEL[id]}
                          </button>
                        ))}
                      </div>
                      <label className="todo-edit-label" htmlFor={`edit-notes-${todo.id}`}>
                        Notes (optional)
                      </label>
                      <textarea
                        id={`edit-notes-${todo.id}`}
                        className="todo-edit-notes"
                        rows={1}
                        value={editNotes}
                        onChange={(e) => setEditNotes(e.target.value)}
                      />
                      <div className="row-due-today todo-edit-due">
                        <label>
                          <span>Due date</span>
                          <input type="date" value={editDue} onChange={(e) => setEditDue(e.target.value)} />
                        </label>
                        <label>
                          <input
                            type="checkbox"
                            checked={editForToday}
                            onChange={(e) => setEditForToday(e.target.checked)}
                          />
                          Mark for today
                        </label>
                      </div>
                      <div className="todo-edit-actions">
                        <div className="todo-edit-actions-start">
                          <button
                            type="button"
                            className="btn-delete-task"
                            disabled={editSaving || removingId !== null}
                            onClick={() => startRemoveTodo(todo)}
                          >
                            Delete
                          </button>
                          <button type="button" className="btn-edit-cancel" onClick={cancelEdit}>
                            Cancel
                          </button>
                        </div>
                        <button
                          type="submit"
                          className="btn-add"
                          disabled={
                            editSaving || editTitle.trim().length === 0 || editCats.size === 0
                          }
                        >
                          Save
                        </button>
                      </div>
                    </form>
                  ) : (
                    <>
                      <div className="todo-title-row">
                        <div className="todo-title-text">
                          <span
                            className={`task-text-wrap ${todo.completed_at ? "done" : ""} ${
                              strikingId === todo.id && !todo.completed_at ? "striking" : ""
                            }`}
                          >
                            <span className="strike-line" onAnimationEnd={() => onStrikeEnd(todo.id)} />
                            <span className="todo-title">{todo.title}</span>
                          </span>
                        </div>
                        <div className="todo-actions">
                          {!todo.completed_at ? (
                            <>
                              <button
                                type="button"
                                className="btn-mark-today"
                                onClick={() => void toggleTodoForToday(todo)}
                                disabled={editingId === todo.id || removingId !== null}
                              >
                                {todo.for_today ? "Remove from Today" : "Mark for today"}
                              </button>
                              <button
                                type="button"
                                className="btn-edit-icon"
                                onClick={() => startEdit(todo)}
                                disabled={removingId !== null}
                                aria-label="Edit task"
                              >
                                <EditPencilIcon />
                              </button>
                            </>
                          ) : null}
                          <button
                            type="button"
                            className="btn-remove-icon"
                            onClick={() => startRemoveTodo(todo)}
                            disabled={
                              strikingId === todo.id || removingId !== null
                            }
                            aria-label="Remove task"
                          >
                            <TrashIcon />
                          </button>
                        </div>
                      </div>
                      <div className="todo-meta">
                        {isTodoOverdue(todo) ? (
                          <span className="tag-chip tag-overdue">Overdue</span>
                        ) : null}
                        {todo.categories.map((c) => (
                          <span key={c} className="tag-chip">
                            {CATEGORY_LABEL[c]}
                          </span>
                        ))}
                        {todo.due_date ? <span>Due {todo.due_date}</span> : null}
                        {todo.for_today ? <span>Today list</span> : null}
                      </div>
                      {todo.notes ? (
                        <div className="notes-block">{linkify(todo.notes)}</div>
                      ) : null}
                    </>
                  )}
                </div>
              </article>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
