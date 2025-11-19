"use client";

import { Check, Moon, Plus, Sun, X } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";

interface Todo {
  id: string;
  text: string;
  completed: boolean;
  createdAt: number;
}

type Filter = "all" | "active" | "completed";

export default function TodoApp() {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState("");
  const [darkMode, setDarkMode] = useState(false);
  const [mounted, setMounted] = useState(false);

  // Load todos and dark mode from localStorage
  useEffect(() => {
    setMounted(true);
    const savedTodos = localStorage.getItem("todos");
    const savedDarkMode = localStorage.getItem("darkMode");

    if (savedTodos) {
      setTodos(JSON.parse(savedTodos));
    }

    if (savedDarkMode) {
      setDarkMode(JSON.parse(savedDarkMode));
      if (JSON.parse(savedDarkMode)) {
        document.documentElement.classList.add("dark");
      }
    }
  }, []);

  // Save todos to localStorage
  useEffect(() => {
    if (mounted) {
      localStorage.setItem("todos", JSON.stringify(todos));
    }
  }, [todos, mounted]);

  // Toggle dark mode
  const toggleDarkMode = () => {
    const newDarkMode = !darkMode;
    setDarkMode(newDarkMode);
    localStorage.setItem("darkMode", JSON.stringify(newDarkMode));

    if (newDarkMode) {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  };

  // Add new todo
  const addTodo = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (inputValue.trim()) {
      const newTodo: Todo = {
        id: Date.now().toString(),
        text: inputValue.trim(),
        completed: false,
        createdAt: Date.now(),
      };
      setTodos([newTodo, ...todos]);
      setInputValue("");
    }
  };

  // Delete todo
  const deleteTodo = (id: string) => {
    setTodos(todos.filter((todo) => todo.id !== id));
  };

  // Toggle todo completion
  const toggleTodo = (id: string) => {
    setTodos(
      todos.map((todo) =>
        todo.id === id ? { ...todo, completed: !todo.completed } : todo
      )
    );
  };

  // Start editing
  const startEditing = (id: string, text: string) => {
    setEditingId(id);
    setEditingText(text);
  };

  // Save edit
  const saveEdit = () => {
    if (editingId && editingText.trim()) {
      setTodos(
        todos.map((todo) =>
          todo.id === editingId ? { ...todo, text: editingText.trim() } : todo
        )
      );
    }
    setEditingId(null);
    setEditingText("");
  };

  // Cancel edit
  const cancelEdit = () => {
    setEditingId(null);
    setEditingText("");
  };

  // Clear completed todos
  const clearCompleted = () => {
    setTodos(todos.filter((todo) => !todo.completed));
  };

  // Filter todos
  const filteredTodos = todos.filter((todo) => {
    if (filter === "active") return !todo.completed;
    if (filter === "completed") return todo.completed;
    return true;
  });

  const activeCount = todos.filter((todo) => !todo.completed).length;
  const completedCount = todos.filter((todo) => todo.completed).length;

  const filterTranslations = {
    all: "Toutes",
    active: "À faire",
    completed: "Terminées",
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900 transition-colors duration-300">
      <div className="container mx-auto px-4 py-8 max-w-2xl">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-4xl md:text-5xl font-bold text-gray-800 dark:text-white transition-colors duration-300">
            Mes Tâches
          </h1>
          <button
            onClick={toggleDarkMode}
            className="p-3 rounded-full bg-white dark:bg-gray-800 shadow-lg hover:shadow-xl transition-all duration-300 hover:scale-110 active:scale-95 border border-gray-200 dark:border-gray-700"
            aria-label="Mode sombre"
          >
            {darkMode ? (
              <Sun className="w-6 h-6 text-yellow-500" />
            ) : (
              <Moon className="w-6 h-6 text-gray-700" />
            )}
          </button>
        </div>

        {/* Add Todo Form */}
        <form onSubmit={addTodo} className="mb-8">
          <div className="flex gap-2">
            <input
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              placeholder="Que faut-il faire ?"
              className="flex-1 px-6 py-4 text-lg rounded-xl bg-white dark:bg-gray-800 border-2 border-gray-200 dark:border-gray-700 focus:border-blue-500 dark:focus:border-blue-400 outline-none transition-all duration-300 text-gray-800 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 shadow-sm hover:shadow-md focus:shadow-lg"
            />
            <button
              type="submit"
              className="px-6 py-4 bg-blue-500 hover:bg-blue-600 text-white rounded-xl font-semibold transition-all duration-300 hover:scale-105 active:scale-95 shadow-lg hover:shadow-xl flex items-center gap-2"
            >
              <Plus className="w-5 h-5" />
              <span className="hidden sm:inline">Ajouter</span>
            </button>
          </div>
        </form>

        {/* Filter Buttons */}
        <div className="flex flex-wrap items-center justify-between gap-4 mb-6 bg-white dark:bg-gray-800 rounded-xl p-4 shadow-md border border-gray-200 dark:border-gray-700 transition-colors duration-300">
          <div className="flex gap-2">
            {(["all", "active", "completed"] as Filter[]).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-4 py-2 rounded-lg font-medium capitalize transition-all duration-300 ${
                  filter === f
                    ? "bg-blue-500 text-white shadow-md scale-105"
                    : "bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600"
                }`}
              >
                {filterTranslations[f]}
              </button>
            ))}
          </div>
          <div className="text-sm text-gray-600 dark:text-gray-400">
            {activeCount}{" "}
            {activeCount === 1 ? "tâche restante" : "tâches restantes"}
          </div>
        </div>

        {/* Todo List */}
        <div className="space-y-2 mb-6">
          {filteredTodos.length === 0 ? (
            <div className="text-center py-16 bg-white dark:bg-gray-800 rounded-xl border-2 border-dashed border-gray-300 dark:border-gray-700 transition-colors duration-300">
              <p className="text-gray-500 dark:text-gray-400 text-lg">
                {filter === "completed"
                  ? "Aucune tâche terminée pour le moment"
                  : filter === "active"
                  ? "Aucune tâche à faire"
                  : "Aucune tâche. Ajoutez-en une ci-dessus !"}
              </p>
            </div>
          ) : (
            filteredTodos.map((todo, index) => (
              <div
                key={todo.id}
                className="group bg-white dark:bg-gray-800 rounded-xl p-4 shadow-sm hover:shadow-lg transition-all duration-300 border border-gray-200 dark:border-gray-700 animate-in fade-in slide-in-from-top-2"
                style={{ animationDelay: `${index * 50}ms` }}
              >
                {editingId === todo.id ? (
                  // Edit Mode
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={editingText}
                      onChange={(e) => setEditingText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") saveEdit();
                        if (e.key === "Escape") cancelEdit();
                      }}
                      className="flex-1 px-4 py-2 text-lg rounded-lg bg-gray-50 dark:bg-gray-700 border-2 border-blue-500 dark:border-blue-400 outline-none text-gray-800 dark:text-white"
                      autoFocus
                    />
                    <button
                      onClick={saveEdit}
                      className="p-2 bg-green-500 hover:bg-green-600 text-white rounded-lg transition-all duration-300 hover:scale-110 active:scale-95"
                      aria-label="Save"
                    >
                      <Check className="w-5 h-5" />
                    </button>
                    <button
                      onClick={cancelEdit}
                      className="p-2 bg-gray-500 hover:bg-gray-600 text-white rounded-lg transition-all duration-300 hover:scale-110 active:scale-95"
                      aria-label="Cancel"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  </div>
                ) : (
                  // View Mode
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => toggleTodo(todo.id)}
                      className={`flex-shrink-0 w-6 h-6 rounded-full border-2 transition-all duration-300 ${
                        todo.completed
                          ? "bg-green-500 border-green-500 scale-110"
                          : "border-gray-300 dark:border-gray-600 hover:border-green-500 dark:hover:border-green-400"
                      } flex items-center justify-center`}
                      aria-label="Toggle todo"
                    >
                      {todo.completed && (
                        <Check className="w-4 h-4 text-white" />
                      )}
                    </button>
                    <span
                      onDoubleClick={() => startEditing(todo.id, todo.text)}
                      className={`flex-1 text-lg cursor-pointer transition-all duration-300 ${
                        todo.completed
                          ? "line-through text-gray-400 dark:text-gray-500"
                          : "text-gray-800 dark:text-white"
                      }`}
                    >
                      {todo.text}
                    </span>
                    <button
                      onClick={() => deleteTodo(todo.id)}
                      className="opacity-0 group-hover:opacity-100 p-2 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-all duration-300 hover:scale-110 active:scale-95"
                      aria-label="Supprimer la tâche"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  </div>
                )}
              </div>
            ))
          )}
        </div>

        {/* Clear Completed Button */}
        {completedCount > 0 && (
          <button
            onClick={clearCompleted}
            className="w-full py-3 bg-red-500 hover:bg-red-600 text-white rounded-xl font-semibold transition-all duration-300 hover:scale-105 active:scale-95 shadow-lg hover:shadow-xl"
          >
            Effacer {completedCount}{" "}
            {completedCount === 1 ? "tâche terminée" : "tâches terminées"}
          </button>
        )}

        {/* Footer Hint */}
        <p className="text-center text-sm text-gray-500 dark:text-gray-400 mt-8">
          Double-cliquez sur une tâche pour la modifier
        </p>
      </div>
    </div>
  );
}
