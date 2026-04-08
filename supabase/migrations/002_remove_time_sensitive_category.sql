-- Time-Sensitive is no longer a stored category; the tab lists todos with a due_date.
update public.todos
set categories = array_remove(categories, 'time-sensitive');
