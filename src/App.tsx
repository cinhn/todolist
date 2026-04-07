import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import "./App.css";
import { supabase, supabaseConfigured } from "./supabaseClient";

export type CategoryId =
  | "time-sensitive"
  | "house-chores"
  | "career"
  | "health"
  | "side-quests";

export type TabId = "everything" | "today" | CategoryId;

const CATEGORY_ORDER: CategoryId[] = [
  "time-sensitive",
  "house-chores",
  "career",
  "health",
  "side-quests",
];

const CATEGORY_LABEL: Record<CategoryId, string> = {
  "time-sensitive": "Time-Sensitive",
  "house-chores": "House Chores",
  career: "Career",
  health: "Health",
  "side-quests": "Side Quests",
};

type TodoRow = {
  id: string;
  title: string;
  categories: CategoryId[];
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

function parseCategories(raw: unknown): CategoryId[] {
  if (!Array.isArray(raw)) return [];
  const set = new Set(CATEGORY_ORDER);
  return raw.filter((c): c is CategoryId => typeof c === "string" && set.has(c as CategoryId));
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

function sortTodosForView(list: TodoRow[]): TodoRow[] {
  const inc = list.filter((t) => !t.completed_at).sort((a, b) => a.sort_key - b.sort_key);
  const done = list
    .filter((t) => t.completed_at)
    .sort((a, b) => {
      const ta = new Date(a.completed_at!).getTime();
      const tb = new Date(b.completed_at!).getTime();
      return ta - tb;
    });
  return [...inc, ...done];
}

function filterByTab(list: TodoRow[], tab: TabId): TodoRow[] {
  const today = localDateString();
  if (tab === "everything") return list;
  if (tab === "today") {
    return list.filter((t) => t.for_today || t.due_date === today);
  }
  return list.filter((t) => t.categories.includes(tab));
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [email, setEmail] = useState("");
  const [authMsg, setAuthMsg] = useState<string | null>(null);
  const [authErr, setAuthErr] = useState<string | null>(null);

  const [todos, setTodos] = useState<TodoRow[]>([]);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [tab, setTab] = useState<TabId>("everything");

  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [due, setDue] = useState("");
  const [forToday, setForToday] = useState(false);
  const [selectedCats, setSelectedCats] = useState<Set<CategoryId>>(new Set());

  const [strikingId, setStrikingId] = useState<string | null>(null);
  const strikeHandledRef = useRef<string | null>(null);

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
    if (!supabase || !user) return;
    void refreshTodos(user);
    const ch = supabase
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
      void supabase.removeChannel(ch);
    };
  }, [user, refreshTodos]);

  const visibleTodos = useMemo(
    () => sortTodosForView(filterByTab(todos, tab)),
    [todos, tab]
  );

  const toggleCat = (id: CategoryId) => {
    setSelectedCats((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const sendMagicLink = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supabase) return;
    setAuthMsg(null);
    setAuthErr(null);
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: window.location.origin },
    });
    if (error) setAuthErr(error.message);
    else setAuthMsg("Check your email for the sign-in link.");
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
    const cats = CATEGORY_ORDER.filter((c) => selectedCats.has(c));
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
  };

  const onCheckStart = (todo: TodoRow) => {
    if (todo.completed_at || strikingId) return;
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
      <div className="app">
        <form className="auth-panel" onSubmit={sendMagicLink}>
          <h1>CINDY&apos;S TO DOs</h1>
          <p>Sign in with your email. We&apos;ll send a magic link so your list syncs on every device.</p>
          <input
            type="email"
            required
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
          />
          <button type="submit" className="btn-add">
            Send magic link
          </button>
          {authMsg ? <p className="auth-msg">{authMsg}</p> : null}
          {authErr ? <p className="auth-err">{authErr}</p> : null}
        </form>
      </div>
    );
  }

  const canAdd = title.trim().length > 0 && selectedCats.size > 0;

  return (
    <div className="app">
      <div className="top-grid">
        <header className="header-with-signout">
          <div>
            <h1 className="brand-title">
              CINDY&apos;S
              <br />
              TO DOs
            </h1>
            <p className="brand-sub">All the things I need to do compiled in one big site.</p>
          </div>
          <div>
            <span className="brand-sub" style={{ fontSize: "0.8rem" }}>
              {user.email}
            </span>
            <br />
            <button type="button" className="sign-out" onClick={() => void signOut()}>
              Sign out
            </button>
          </div>
        </header>

        <form className="input-card" onSubmit={addTodo}>
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
          <span className="field-label">Categories (pick at least one)</span>
          <div className="pills-row">
            {CATEGORY_ORDER.map((id) => (
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
            Notes / links (optional)
          </label>
          <textarea
            id="task-notes"
            placeholder="URLs or reminders…"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
          <div className="row-due-today">
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
              Include in Today
            </label>
          </div>
          <div className="add-row">
            <button type="submit" className="btn-add" disabled={!canAdd}>
              Add to list
            </button>
          </div>
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
          {CATEGORY_ORDER.map((id) => (
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
            <p className="list-empty">Nothing here yet.</p>
          ) : (
            visibleTodos.map((todo) => (
              <article key={todo.id} className="todo-item">
                <input
                  type="checkbox"
                  className="todo-check"
                  checked={Boolean(todo.completed_at) || strikingId === todo.id}
                  disabled={Boolean(todo.completed_at) || strikingId === todo.id}
                  onChange={() => onCheckStart(todo)}
                />
                <div className="todo-body">
                  <div className="todo-title-row">
                    <span
                      className={`task-text-wrap ${todo.completed_at ? "done" : ""} ${
                        strikingId === todo.id && !todo.completed_at ? "striking" : ""
                      }`}
                    >
                      <span className="strike-line" onAnimationEnd={() => onStrikeEnd(todo.id)} />
                      <span className="todo-title">{todo.title}</span>
                    </span>
                  </div>
                  <div className="todo-meta">
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
                </div>
              </article>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
