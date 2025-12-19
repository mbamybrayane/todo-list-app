"use client";

import { Check, ChevronRight, Moon, Plus, Sun, X, Search, Undo2, Redo2, Focus, Trash2 } from "lucide-react";
import { useEffect, useState, useMemo, useRef, useCallback, type FormEvent } from "react";

// ============================================================================
// INTERFACES & TYPES
// ============================================================================

interface Todo {
  id: string;
  text: string;
  completed: boolean;
  createdAt: number;
  children: string[];      // Array of child todo IDs
  expanded?: boolean;      // Expand/collapse state
  parentId?: string;       // Reference to parent for quick traversal
}

interface FlattenedTodo {
  todo: Todo;
  depth: number;
  path: string[];         // Full breadcrumb path from root
  hasChildren: boolean;
  visibleChildrenCount: number;
}

type Filter = "all" | "active" | "completed";

interface PerformanceStats {
  renderTime: number;
  todoCount: number;
  visibleCount: number;
  maxDepth: number;
  memoryUsage?: number;
}

interface HistoryState {
  todos: Todo[];
  timestamp: number;
}

// ============================================================================
// UTILITY FUNCTIONS - Critical algorithms with inline comments
// ============================================================================

/**
 * Safe localStorage wrapper with try/catch error handling
 * Prevents app crashes if localStorage is unavailable or quota exceeded
 */
const safeLocalStorage = {
  get: (key: string): string | null => {
    try {
      return localStorage.getItem(key);
    } catch (e) {
      console.error("localStorage.getItem error:", e);
      return null;
    }
  },
  set: (key: string, value: string): void => {
    try {
      localStorage.setItem(key, value);
    } catch (e) {
      console.error("localStorage.setItem error:", e);
    }
  },
};

/**
 * Generate collision-resistant unique ID
 */
const generateId = (): string => `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

/**
 * CRITICAL: Cycle Detection Algorithm
 * Prevents a todo from becoming its own ancestor (direct or indirect)
 * Walk up the parent chain from newParentId - if we encounter targetId, it's a cycle
 * 
 * Example: If we try to move "A" into its child "B > C", this would create:
 * C -> B -> A -> ... infinite loop. This function prevents that.
 */
const wouldCreateCycle = (
  targetId: string,
  newParentId: string | null,
  todosMap: Map<string, Todo>
): boolean => {
  if (!newParentId || targetId === newParentId) return true;
  
  let currentId: string | undefined = newParentId;
  const visited = new Set<string>();
  
  // Walk up the parent chain
  while (currentId) {
    if (currentId === targetId) return true; // Cycle detected!
    if (visited.has(currentId)) return true; // Already has circular reference
    visited.add(currentId);
    
    const current = todosMap.get(currentId);
    currentId = current?.parentId;
  }
  
  return false;
};

/**
 * Get all descendants of a todo recursively (for bulk operations like delete)
 * Uses iterative approach with stack to avoid call stack overflow
 */
const getAllDescendants = (todoId: string, todosMap: Map<string, Todo>): string[] => {
  const todo = todosMap.get(todoId);
  if (!todo || !todo.children.length) return [];
  
  const descendants: string[] = [];
  const stack = [...todo.children];
  
  while (stack.length > 0) {
    const childId = stack.pop()!;
    descendants.push(childId);
    
    const child = todosMap.get(childId);
    if (child && child.children.length > 0) {
      stack.push(...child.children);
    }
  }
  
  return descendants;
};

/**
 * Recursive completion statistics calculation
 * Returns { completed, total } for a todo and ALL its descendants
 */
const getCompletionStats = (
  todo: Todo,
  todosMap: Map<string, Todo>
): { completed: number; total: number } => {
  let completed = todo.completed ? 1 : 0;
  let total = 1;
  
  todo.children.forEach((childId) => {
    const child = todosMap.get(childId);
    if (child) {
      const childStats = getCompletionStats(child, todosMap);
      completed += childStats.completed;
      total += childStats.total;
    }
  });
  
  return { completed, total };
};

/**
 * Get full breadcrumb path from root to todo
 * Used for search result display and focus mode
 */
const getFullPath = (todoId: string, todosMap: Map<string, Todo>): string[] => {
  const path: string[] = [];
  let currentId: string | undefined = todoId;
  
  while (currentId) {
    const todo = todosMap.get(currentId);
    if (!todo) break;
    path.unshift(todo.text);
    currentId = todo.parentId;
  }
  
  return path;
};

/**
 * Calculate maximum depth of entire tree
 * Used for performance monitoring
 */
const calculateMaxDepth = (todos: Todo[], todosMap: Map<string, Todo>): number => {
  let maxDepth = 0;
  
  const calculateDepth = (todoId: string, depth: number): void => {
    maxDepth = Math.max(maxDepth, depth);
    const todo = todosMap.get(todoId);
    if (todo && todo.children.length > 0) {
      todo.children.forEach((childId) => calculateDepth(childId, depth + 1));
    }
  };
  
  // Start from root-level todos
  todos.filter((t) => !t.parentId).forEach((t) => calculateDepth(t.id, 1));
  
  return maxDepth;
};

/**
 * Schema migration: Handle todos from old format without children field
 * Ensures backward compatibility
 */
const migrateTodos = (todos: Todo[]): Todo[] => {
  return todos.map((todo) => ({
    ...todo,
    children: todo.children || [],
    expanded: todo.expanded !== undefined ? todo.expanded : true,
  }));
};

/**
 * Fix data corruption: Regenerate duplicate IDs
 * Handles edge case where data corruption causes duplicate IDs
 */
const fixDuplicateIds = (todos: Todo[]): Todo[] => {
  const seenIds = new Set<string>();
  const fixed: Todo[] = [];
  
  todos.forEach((todo) => {
    if (seenIds.has(todo.id)) {
      const newTodo = { ...todo, id: generateId() };
      fixed.push(newTodo);
      seenIds.add(newTodo.id);
    } else {
      fixed.push(todo);
      seenIds.add(todo.id);
    }
  });
  
  return fixed;
};

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export default function TodoApp() {
  // ===== Core State =====
  const [todos, setTodos] = useState<Todo[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState("");
  const [darkMode, setDarkMode] = useState(false);
  const [mounted, setMounted] = useState(false);
  
  // ===== Search State (with 300ms debounce) =====
  const [searchTerm, setSearchTerm] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  
  // ===== Advanced Features State =====
  const [focusedTodoId, setFocusedTodoId] = useState<string | null>(null);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [dragPosition, setDragPosition] = useState<"before" | "after" | "child" | null>(null);
  
  // ===== Undo/Redo History (max 5 states) =====
  const [history, setHistory] = useState<HistoryState[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  
  // ===== Performance Monitoring =====
  const [performanceStats, setPerformanceStats] = useState<PerformanceStats>({
    renderTime: 0,
    todoCount: 0,
    visibleCount: 0,
    maxDepth: 0,
  });
  const renderStartRef = useRef<number>(0);
  
  // ===== Virtualization State =====
  const [scrollTop, setScrollTop] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const ITEM_HEIGHT = 80; // Approximate height per item
  const VIEWPORT_BUFFER = 5; // Extra items to render above/below viewport

  // ===== Load from localStorage on mount =====
  useEffect(() => {
    setMounted(true);
    const savedTodos = safeLocalStorage.get("todos-hierarchical");
    const savedDarkMode = safeLocalStorage.get("darkMode");
    
    if (savedTodos) {
      try {
        let parsed = JSON.parse(savedTodos);
        parsed = migrateTodos(parsed);
        parsed = fixDuplicateIds(parsed);
        setTodos(parsed);
      } catch (e) {
        console.error("Failed to parse todos:", e);
      }
    }
    
    if (savedDarkMode) {
      const isDark = JSON.parse(savedDarkMode);
      setDarkMode(isDark);
      if (isDark) {
        document.documentElement.classList.add("dark");
      }
    }
  }, []);

  // ===== Save to localStorage on change =====
  useEffect(() => {
    if (mounted) {
      safeLocalStorage.set("todos-hierarchical", JSON.stringify(todos));
    }
  }, [todos, mounted]);

  // ===== 300ms Debounced Search =====
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchTerm), 300);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  // ===== Create todos map for O(1) lookup (cached with useMemo) =====
  const todosMap = useMemo(() => {
    const map = new Map<string, Todo>();
    todos.forEach((todo) => map.set(todo.id, todo));
    return map;
  }, [todos]);

  /**
   * CRITICAL: Tree Flattening Algorithm
   * Converts hierarchical tree into flat array respecting:
   * - Expand/collapse state
   * - Current filter (all/active/completed)
   * - Search term (with full path matching)
   * - Focus mode
   * 
   * This is heavily optimized with useMemo to avoid re-flattening on every render
   */
  const flattenedTodos = useMemo(() => {
    const flattened: FlattenedTodo[] = [];
    
    // Determine if todo matches current filters
    const shouldShowTodo = (todo: Todo, includeChildrenCheck: boolean = true): boolean => {
      // Filter by completion status
      if (filter === "active" && todo.completed && !includeChildrenCheck) return false;
      if (filter === "completed" && !todo.completed && !includeChildrenCheck) return false;
      
      // Search filter with full path matching
      if (debouncedSearch) {
        const path = getFullPath(todo.id, todosMap);
        const fullPath = path.join(" > ").toLowerCase();
        const searchLower = debouncedSearch.toLowerCase();
        
        // Show if this todo or any descendant matches
        const matchesThis = fullPath.includes(searchLower);
        const hasMatchingDescendant = todo.children.some((childId) => {
          const child = todosMap.get(childId);
          return child && shouldShowTodo(child, false);
        });
        
        return matchesThis || hasMatchingDescendant;
      }
      
      return true;
    };
    
    // Recursive flattening with depth tracking
    const flattenRecursive = (todoId: string, depth: number, parentPath: string[]): void => {
      const todo = todosMap.get(todoId);
      if (!todo) return;
      
      const currentPath = [...parentPath, todo.text];
      
      // Check filters
      if (!shouldShowTodo(todo)) return;
      
      flattened.push({
        todo,
        depth,
        path: currentPath,
        hasChildren: todo.children.length > 0,
        visibleChildrenCount: todo.children.length,
      });
      
      // Recursively flatten children if expanded
      if (todo.expanded && todo.children.length > 0) {
        todo.children.forEach((childId) => {
          flattenRecursive(childId, depth + 1, currentPath);
        });
      }
    };
    
    // Start with root-level todos or focused branch
    const rootTodos = focusedTodoId
      ? [focusedTodoId]
      : todos.filter((t) => !t.parentId).map((t) => t.id);
    
    rootTodos.forEach((todoId) => flattenRecursive(todoId, 0, []));
    
    return flattened;
  }, [todos, todosMap, filter, debouncedSearch, focusedTodoId]);

  /**
   * VIRTUALIZATION: Calculate visible range
   * Only render items in viewport + buffer zone
   * Critical for performance with 500+ items
   */
  const visibleTodos = useMemo(() => {
    const viewportHeight = containerRef.current?.clientHeight || 600;
    const startIndex = Math.max(0, Math.floor(scrollTop / ITEM_HEIGHT) - VIEWPORT_BUFFER);
    const endIndex = Math.min(
      flattenedTodos.length,
      Math.ceil((scrollTop + viewportHeight) / ITEM_HEIGHT) + VIEWPORT_BUFFER
    );
    
    return flattenedTodos.slice(startIndex, endIndex).map((ft, idx) => ({
      ...ft,
      virtualIndex: startIndex + idx,
    }));
  }, [flattenedTodos, scrollTop]);

  // ===== Performance Monitoring - Track render time =====
  useEffect(() => {
    renderStartRef.current = performance.now();
  });

  useEffect(() => {
    const renderTime = performance.now() - renderStartRef.current;
    const maxDepth = calculateMaxDepth(todos, todosMap);
    
    setPerformanceStats({
      renderTime: Math.round(renderTime * 100) / 100,
      todoCount: todos.length,
      visibleCount: visibleTodos.length,
      maxDepth,
      memoryUsage: (performance as any).memory?.usedJSHeapSize
        ? Math.round((performance as any).memory.usedJSHeapSize / 1024 / 1024)
        : undefined,
    });
  });

  // ===== History Management for Undo/Redo =====
  const saveToHistory = useCallback(() => {
    const newHistory = history.slice(0, historyIndex + 1);
    newHistory.push({ 
      todos: JSON.parse(JSON.stringify(todos)), 
      timestamp: Date.now() 
    });
    
    // Keep only last 5 states
    if (newHistory.length > 5) {
      newHistory.shift();
    } else {
      setHistoryIndex((prev) => prev + 1);
    }
    
    setHistory(newHistory);
  }, [todos, history, historyIndex]);

  const undo = useCallback(() => {
    if (historyIndex > 0) {
      setHistoryIndex((prev) => prev - 1);
      setTodos(JSON.parse(JSON.stringify(history[historyIndex - 1].todos)));
    }
  }, [historyIndex, history]);

  const redo = useCallback(() => {
    if (historyIndex < history.length - 1) {
      setHistoryIndex((prev) => prev + 1);
      setTodos(JSON.parse(JSON.stringify(history[historyIndex + 1].todos)));
    }
  }, [historyIndex, history]);

  // ===== CRUD Operations =====
  
  const toggleDarkMode = () => {
    const newDarkMode = !darkMode;
    setDarkMode(newDarkMode);
    safeLocalStorage.set("darkMode", JSON.stringify(newDarkMode));
    
    if (newDarkMode) {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  };

  const addTodo = (e: FormEvent<HTMLFormElement>, parentId?: string) => {
    e.preventDefault();
    if (inputValue.trim()) {
      const newTodo: Todo = {
        id: generateId(),
        text: inputValue.trim(),
        completed: false,
        createdAt: Date.now(),
        children: [],
        expanded: true,
        parentId,
      };
      
      const updatedTodos = [...todos, newTodo];
      
      // If adding as child, update parent's children array
      if (parentId) {
        const parentIndex = updatedTodos.findIndex((t) => t.id === parentId);
        if (parentIndex !== -1) {
          updatedTodos[parentIndex] = {
            ...updatedTodos[parentIndex],
            children: [...updatedTodos[parentIndex].children, newTodo.id],
            expanded: true,
          };
        }
      }
      
      setTodos(updatedTodos);
      setInputValue("");
    }
  };

  const deleteTodo = (id: string) => {
    saveToHistory();
    
    // Get all descendants to delete (entire subtree)
    const toDelete = new Set([id, ...getAllDescendants(id, todosMap)]);
    
    // Remove from parent's children array
    const todo = todosMap.get(id);
    if (todo?.parentId) {
      const updatedTodos = todos.map((t) =>
        t.id === todo.parentId
          ? { ...t, children: t.children.filter((cId) => cId !== id) }
          : t
      );
      setTodos(updatedTodos.filter((t) => !toDelete.has(t.id)));
    } else {
      setTodos(todos.filter((t) => !toDelete.has(t.id)));
    }
  };

  /**
   * Toggle todo completion with parent auto-completion
   * If all children are completed, auto-complete the parent
   */
  const toggleTodo = (id: string) => {
    const todo = todosMap.get(id);
    if (!todo) return;
    
    const newCompleted = !todo.completed;
    const updatedTodos = [...todos];
    
    // Toggle the todo
    const todoIndex = updatedTodos.findIndex((t) => t.id === id);
    if (todoIndex !== -1) {
      updatedTodos[todoIndex] = { ...updatedTodos[todoIndex], completed: newCompleted };
    }
    
    // Auto-complete parent if all children are completed
    if (todo.parentId) {
      const parent = todosMap.get(todo.parentId);
      if (parent) {
        const allChildrenCompleted = parent.children.every((childId) => {
          const child = childId === id ? updatedTodos[todoIndex] : todosMap.get(childId);
          return child?.completed;
        });
        
        if (allChildrenCompleted) {
          const parentIndex = updatedTodos.findIndex((t) => t.id === todo.parentId);
          if (parentIndex !== -1) {
            updatedTodos[parentIndex] = { ...updatedTodos[parentIndex], completed: true };
          }
        }
      }
    }
    
    setTodos(updatedTodos);
  };

  const toggleExpanded = (id: string) => {
    setTodos(
      todos.map((todo) =>
        todo.id === id ? { ...todo, expanded: !todo.expanded } : todo
      )
    );
  };

  const startEditing = (id: string, text: string) => {
    setEditingId(id);
    setEditingText(text);
  };

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

  const cancelEdit = () => {
    setEditingId(null);
    setEditingText("");
  };

  // ===== Native HTML5 Drag & Drop Handlers =====
  
  const handleDragStart = (e: React.DragEvent, todoId: string) => {
    setDraggedId(todoId);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", todoId);
    
    // Create semi-transparent drag image
    const dragImage = e.currentTarget.cloneNode(true) as HTMLElement;
    dragImage.style.opacity = "0.5";
    dragImage.style.position = "absolute";
    dragImage.style.top = "-1000px";
    document.body.appendChild(dragImage);
    e.dataTransfer.setDragImage(dragImage, 0, 0);
    setTimeout(() => document.body.removeChild(dragImage), 0);
  };

  const handleDragOver = (e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    
    if (!draggedId || draggedId === targetId) {
      setDragOverId(null);
      return;
    }
    
    // CRITICAL: Real-time cycle detection
    const wouldCycle = wouldCreateCycle(draggedId, targetId, todosMap);
    
    if (wouldCycle) {
      e.dataTransfer.dropEffect = "none";
      setDragOverId(null);
      setDragPosition(null);
      return;
    }
    
    e.dataTransfer.dropEffect = "move";
    setDragOverId(targetId);
    
    // Determine drop position based on mouse Y within element
    const rect = e.currentTarget.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const height = rect.height;
    
    if (y < height * 0.25) {
      setDragPosition("before");
    } else if (y > height * 0.75) {
      setDragPosition("after");
    } else {
      setDragPosition("child");
    }
  };

  const handleDragLeave = () => {
    setDragOverId(null);
    setDragPosition(null);
  };

  const handleDrop = (e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    
    if (!draggedId || draggedId === targetId) return;
    
    const draggedTodo = todosMap.get(draggedId);
    const targetTodo = todosMap.get(targetId);
    
    if (!draggedTodo || !targetTodo) return;
    
    // Final cycle check before committing
    if (wouldCreateCycle(draggedId, targetId, todosMap)) {
      setDraggedId(null);
      setDragOverId(null);
      setDragPosition(null);
      return;
    }
    
    saveToHistory();
    
    let updatedTodos = [...todos];
    
    // Remove from old parent's children array
    if (draggedTodo.parentId) {
      updatedTodos = updatedTodos.map((t) =>
        t.id === draggedTodo.parentId
          ? { ...t, children: t.children.filter((cId) => cId !== draggedId) }
          : t
      );
    }
    
    const draggedIndex = updatedTodos.findIndex((t) => t.id === draggedId);
    
    if (dragPosition === "child") {
      // Add as child of target
      updatedTodos[draggedIndex] = { ...updatedTodos[draggedIndex], parentId: targetId };
      updatedTodos = updatedTodos.map((t) =>
        t.id === targetId
          ? { ...t, children: [...t.children, draggedId], expanded: true }
          : t
      );
    } else {
      // Add as sibling (before or after target)
      const newParentId = targetTodo.parentId;
      updatedTodos[draggedIndex] = { ...updatedTodos[draggedIndex], parentId: newParentId };
      
      if (newParentId) {
        updatedTodos = updatedTodos.map((t) => {
          if (t.id === newParentId) {
            const targetIndex = t.children.indexOf(targetId);
            const newChildren = [...t.children];
            const insertIndex = dragPosition === "before" ? targetIndex : targetIndex + 1;
            newChildren.splice(insertIndex, 0, draggedId);
            return { ...t, children: newChildren };
          }
          return t;
        });
      }
    }
    
    setTodos(updatedTodos);
    setDraggedId(null);
    setDragOverId(null);
    setDragPosition(null);
  };

  const handleDragEnd = () => {
    setDraggedId(null);
    setDragOverId(null);
    setDragPosition(null);
  };

  // ===== Keyboard Navigation (ARIA Treeview Pattern) =====
  
  const handleKeyDown = (e: React.KeyboardEvent, todoId: string) => {
    const todo = todosMap.get(todoId);
    if (!todo) return;
    
    switch (e.key) {
      case "ArrowRight":
        if (todo.children.length > 0 && !todo.expanded) {
          e.preventDefault();
          toggleExpanded(todoId);
        }
        break;
      case "ArrowLeft":
        if (todo.children.length > 0 && todo.expanded) {
          e.preventDefault();
          toggleExpanded(todoId);
        }
        break;
      case "Enter":
        if (!e.shiftKey) {
          e.preventDefault();
          toggleTodo(todoId);
        }
        break;
    }
  };

  // ===== Render Individual Todo Item =====
  
  const renderTodoItem = (flattened: FlattenedTodo & { virtualIndex: number }) => {
    const { todo, depth, path, hasChildren } = flattened;
    const stats = getCompletionStats(todo, todosMap);
    const progressPercent = stats.total > 0 ? (stats.completed / stats.total) * 100 : 0;
    
    const isDragging = draggedId === todo.id;
    const isDragOver = dragOverId === todo.id;
    const isInvalidDrop = isDragOver && wouldCreateCycle(draggedId!, todo.id, todosMap);
    
    const paddingLeft = depth * 24;
    
    return (
      <div
        key={todo.id}
        draggable
        onDragStart={(e) => handleDragStart(e, todo.id)}
        onDragOver={(e) => handleDragOver(e, todo.id)}
        onDragLeave={handleDragLeave}
        onDrop={(e) => handleDrop(e, todo.id)}
        onDragEnd={handleDragEnd}
        onKeyDown={(e) => handleKeyDown(e, todo.id)}
        tabIndex={0}
        role="treeitem"
        aria-level={depth + 1}
        aria-expanded={hasChildren ? todo.expanded : undefined}
        className={`group relative bg-white dark:bg-gray-800 rounded-lg p-3 shadow-sm hover:shadow-md transition-all duration-200 border-2 ${
          isDragging
            ? "opacity-40 scale-95"
            : isDragOver && isInvalidDrop
            ? "border-red-500 bg-red-50 dark:bg-red-900/20 cursor-not-allowed"
            : isDragOver && dragPosition === "child"
            ? "border-blue-500 bg-blue-50 dark:bg-blue-900/20"
            : isDragOver && dragPosition === "before"
            ? "border-t-4 border-t-green-500"
            : isDragOver && dragPosition === "after"
            ? "border-b-4 border-b-green-500"
            : "border-gray-200 dark:border-gray-700"
        }`}
        style={{
          paddingLeft: `${paddingLeft + 12}px`,
          cursor: isDragOver && isInvalidDrop ? "not-allowed" : "grab",
        }}
      >
        {editingId === todo.id ? (
          // ===== Edit Mode =====
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={editingText}
              onChange={(e) => setEditingText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") saveEdit();
                if (e.key === "Escape") cancelEdit();
              }}
              className="flex-1 px-3 py-2 text-base rounded-lg bg-gray-50 dark:bg-gray-700 border-2 border-blue-500 outline-none text-gray-800 dark:text-white"
              autoFocus
            />
            <button
              onClick={saveEdit}
              className="p-2 bg-green-500 hover:bg-green-600 text-white rounded-lg transition-all"
              aria-label="Save"
            >
              <Check className="w-4 h-4" />
            </button>
            <button
              onClick={cancelEdit}
              className="p-2 bg-gray-500 hover:bg-gray-600 text-white rounded-lg transition-all"
              aria-label="Cancel"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        ) : (
          // ===== View Mode =====
          <div className="flex items-center gap-2">
            {/* Expand/Collapse Arrow with smooth rotation animation */}
            {hasChildren && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  toggleExpanded(todo.id);
                }}
                className="flex-shrink-0 p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-all"
                aria-label={todo.expanded ? "Collapse" : "Expand"}
              >
                <ChevronRight
                  className={`w-4 h-4 text-gray-600 dark:text-gray-400 transition-transform duration-200 ${
                    todo.expanded ? "rotate-90" : ""
                  }`}
                />
              </button>
            )}
            
            {/* Completion Checkbox */}
            <button
              onClick={() => toggleTodo(todo.id)}
              className={`flex-shrink-0 w-5 h-5 rounded-full border-2 transition-all duration-200 ${
                todo.completed
                  ? "bg-green-500 border-green-500 scale-110"
                  : "border-gray-300 dark:border-gray-600 hover:border-green-500"
              } flex items-center justify-center`}
              aria-label="Toggle completion"
            >
              {todo.completed && <Check className="w-3 h-3 text-white" />}
            </button>
            
            {/* Todo Text & Progress */}
            <div className="flex-1 min-w-0">
              <span
                onDoubleClick={() => startEditing(todo.id, todo.text)}
                className={`block text-base cursor-pointer transition-all ${
                  todo.completed
                    ? "line-through text-gray-400 dark:text-gray-500"
                    : "text-gray-800 dark:text-white"
                }`}
              >
                {todo.text}
              </span>
              
              {/* Full path breadcrumb when searching */}
              {debouncedSearch && (
                <div className="text-xs text-gray-500 dark:text-gray-400 mt-1 truncate">
                  {path.join(" > ")}
                </div>
              )}
              
              {/* Progress bar for parent todos */}
              {hasChildren && (
                <div className="mt-2">
                  <div className="flex items-center justify-between text-xs text-gray-600 dark:text-gray-400 mb-1">
                    <span>
                      {stats.completed}/{stats.total} completed
                    </span>
                    <span>{Math.round(progressPercent)}%</span>
                  </div>
                  <div className="h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                    <div
                      className={`h-full transition-all duration-300 ${
                        progressPercent === 100
                          ? "bg-green-500"
                          : progressPercent > 50
                          ? "bg-yellow-500"
                          : "bg-blue-500"
                      }`}
                      style={{ width: `${progressPercent}%` }}
                    />
                  </div>
                </div>
              )}
            </div>
            
            {/* Action Buttons - Hidden until hover */}
            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <button
                onClick={() => {
                  const text = prompt("Add subtask:");
                  if (text?.trim()) {
                    const newTodo: Todo = {
                      id: generateId(),
                      text: text.trim(),
                      completed: false,
                      createdAt: Date.now(),
                      children: [],
                      expanded: true,
                      parentId: todo.id,
                    };
                    setTodos([
                      ...todos.map((t) =>
                        t.id === todo.id
                          ? { ...t, children: [...t.children, newTodo.id], expanded: true }
                          : t
                      ),
                      newTodo,
                    ]);
                  }
                }}
                className="p-1.5 text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded transition-all"
                aria-label="Add subtask"
                title="Add subtask"
              >
                <Plus className="w-4 h-4" />
              </button>
              
              <button
                onClick={() => setFocusedTodoId(todo.id)}
                className="p-1.5 text-purple-500 hover:bg-purple-50 dark:hover:bg-purple-900/20 rounded transition-all"
                aria-label="Focus mode"
                title="Focus this branch"
              >
                <Focus className="w-4 h-4" />
              </button>
              
              <button
                onClick={() => deleteTodo(todo.id)}
                className="p-1.5 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-all"
                aria-label="Delete"
                title="Delete (with subtasks)"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    );
  };

  const activeCount = todos.filter((todo) => !todo.completed).length;

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-pink-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900 transition-colors duration-300">
      {/* ===== Performance Monitor Overlay ===== */}
      <div className="fixed top-4 right-4 bg-white dark:bg-gray-800 rounded-lg shadow-lg p-3 text-xs font-mono border-2 border-gray-200 dark:border-gray-700 z-50">
        <div className="font-bold mb-2 text-gray-800 dark:text-white">⚡ Performance</div>
        <div
          className={`font-semibold ${
            performanceStats.renderTime < 16
              ? "text-green-600"
              : performanceStats.renderTime < 33
              ? "text-yellow-600"
              : "text-red-600"
          }`}
        >
          Render: {performanceStats.renderTime}ms
        </div>
        <div className="text-gray-600 dark:text-gray-400">Todos: {performanceStats.todoCount}</div>
        <div className="text-gray-600 dark:text-gray-400">Visible: {performanceStats.visibleCount}</div>
        <div className="text-gray-600 dark:text-gray-400">Depth: {performanceStats.maxDepth}</div>
        {performanceStats.memoryUsage && (
          <div className="text-gray-600 dark:text-gray-400">
            Memory: {performanceStats.memoryUsage}MB
          </div>
        )}
      </div>

      <div className="container mx-auto px-4 py-8 max-w-4xl">
        {/* ===== Header ===== */}
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-5xl font-bold bg-gradient-to-r from-indigo-600 to-pink-600 bg-clip-text text-transparent">
            Hierarchical Tasks
          </h1>
          <div className="flex items-center gap-2">
            {/* Undo/Redo Buttons */}
            <button
              onClick={undo}
              disabled={historyIndex <= 0}
              className="p-3 rounded-full bg-white dark:bg-gray-800 shadow-lg hover:shadow-xl transition-all disabled:opacity-30 disabled:cursor-not-allowed border border-gray-200 dark:border-gray-700 hover:scale-110 active:scale-95"
              aria-label="Undo"
              title="Undo (Ctrl+Z)"
            >
              <Undo2 className="w-5 h-5 text-gray-700 dark:text-gray-300" />
            </button>
            <button
              onClick={redo}
              disabled={historyIndex >= history.length - 1}
              className="p-3 rounded-full bg-white dark:bg-gray-800 shadow-lg hover:shadow-xl transition-all disabled:opacity-30 disabled:cursor-not-allowed border border-gray-200 dark:border-gray-700 hover:scale-110 active:scale-95"
              aria-label="Redo"
              title="Redo (Ctrl+Y)"
            >
              <Redo2 className="w-5 h-5 text-gray-700 dark:text-gray-300" />
            </button>
            
            {/* Dark Mode Toggle */}
            <button
              onClick={toggleDarkMode}
              className="p-3 rounded-full bg-white dark:bg-gray-800 shadow-lg hover:shadow-xl transition-all hover:scale-110 active:scale-95 border border-gray-200 dark:border-gray-700"
              aria-label="Toggle dark mode"
            >
              {darkMode ? (
                <Sun className="w-5 h-5 text-yellow-500" />
              ) : (
                <Moon className="w-5 h-5 text-gray-700" />
              )}
            </button>
          </div>
        </div>

        {/* ===== Focus Mode Breadcrumb ===== */}
        {focusedTodoId && (
          <div className="mb-4 p-3 bg-purple-100 dark:bg-purple-900/30 rounded-lg flex items-center justify-between border-2 border-purple-300 dark:border-purple-700">
            <div className="flex items-center gap-2 text-purple-800 dark:text-purple-200">
              <Focus className="w-4 h-4" />
              <span className="font-medium">Focus Mode:</span>
              <span className="font-semibold">{getFullPath(focusedTodoId, todosMap).join(" > ")}</span>
            </div>
            <button
              onClick={() => setFocusedTodoId(null)}
              className="p-1 hover:bg-purple-200 dark:hover:bg-purple-800 rounded transition-all"
              aria-label="Exit focus mode"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* ===== Search Bar (300ms debounced) ===== */}
        <div className="mb-4">
          <div className="relative">
            <Search className="absolute left-4 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search tasks... (300ms debounced)"
              className="w-full pl-12 pr-4 py-3 text-base rounded-xl bg-white dark:bg-gray-800 border-2 border-gray-200 dark:border-gray-700 focus:border-indigo-500 dark:focus:border-indigo-400 outline-none transition-all text-gray-800 dark:text-white placeholder-gray-400 shadow-sm focus:shadow-md"
            />
          </div>
        </div>

        {/* ===== Add Todo Form ===== */}
        <form onSubmit={(e) => addTodo(e)} className="mb-6">
          <div className="flex gap-2">
            <input
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              placeholder="What needs to be done?"
              className="flex-1 px-6 py-4 text-lg rounded-xl bg-white dark:bg-gray-800 border-2 border-gray-200 dark:border-gray-700 focus:border-indigo-500 dark:focus:border-indigo-400 outline-none transition-all text-gray-800 dark:text-white placeholder-gray-400 shadow-sm focus:shadow-md"
            />
            <button
              type="submit"
              className="px-6 py-4 bg-gradient-to-r from-indigo-500 to-pink-500 hover:from-indigo-600 hover:to-pink-600 text-white rounded-xl font-semibold transition-all hover:scale-105 active:scale-95 shadow-lg hover:shadow-xl flex items-center gap-2"
            >
              <Plus className="w-5 h-5" />
              <span className="hidden sm:inline">Add Task</span>
            </button>
          </div>
        </form>

        {/* ===== Filter Buttons ===== */}
        <div className="flex flex-wrap items-center justify-between gap-4 mb-6 bg-white dark:bg-gray-800 rounded-xl p-4 shadow-md border border-gray-200 dark:border-gray-700">
          <div className="flex gap-2">
            {(["all", "active", "completed"] as Filter[]).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-4 py-2 rounded-lg font-medium capitalize transition-all ${
                  filter === f
                    ? "bg-gradient-to-r from-indigo-500 to-pink-500 text-white shadow-md scale-105"
                    : "bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600"
                }`}
              >
                {f}
              </button>
            ))}
          </div>
          <div className="text-sm text-gray-600 dark:text-gray-400 font-medium">
            {activeCount} {activeCount === 1 ? "task" : "tasks"} remaining
          </div>
        </div>

        {/* ===== Todo List with Virtualization ===== */}
        <div
          ref={containerRef}
          role="tree"
          aria-label="Hierarchical task list"
          className="space-y-2 mb-6 max-h-[600px] overflow-y-auto scrollbar-thin scrollbar-thumb-gray-300 dark:scrollbar-thumb-gray-600"
          onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
        >
          {flattenedTodos.length === 0 ? (
            <div className="text-center py-16 bg-white dark:bg-gray-800 rounded-xl border-2 border-dashed border-gray-300 dark:border-gray-700">
              <p className="text-gray-500 dark:text-gray-400 text-lg">
                {searchTerm
                  ? "🔍 No tasks match your search"
                  : filter === "completed"
                  ? "✅ No completed tasks"
                  : filter === "active"
                  ? "📋 No active tasks"
                  : "📝 No tasks yet. Add one above!"}
              </p>
            </div>
          ) : (
            <>
              {/* Top spacer for virtualization */}
              {visibleTodos.length > 0 && visibleTodos[0].virtualIndex > 0 && (
                <div style={{ height: `${visibleTodos[0].virtualIndex * ITEM_HEIGHT}px` }} />
              )}
              
              {/* Visible todos */}
              {visibleTodos.map((ft) => renderTodoItem(ft))}
              
              {/* Bottom spacer for virtualization */}
              {visibleTodos.length > 0 &&
                visibleTodos[visibleTodos.length - 1].virtualIndex < flattenedTodos.length - 1 && (
                  <div
                    style={{
                      height: `${
                        (flattenedTodos.length -
                          1 -
                          visibleTodos[visibleTodos.length - 1].virtualIndex) *
                        ITEM_HEIGHT
                      }px`,
                    }}
                  />
                )}
            </>
          )}
        </div>

        {/* ===== Footer Hints ===== */}
        <div className="text-center text-sm text-gray-500 dark:text-gray-400 space-y-1">
          <p>💡 <strong>Double-click</strong> to edit • <strong>Drag</strong> to reorder • <strong>Arrow keys</strong> to expand/collapse</p>
          <p>⚡ Native HTML5 drag-and-drop with real-time cycle detection • {flattenedTodos.length} items rendered</p>
          <p>🎯 <strong>Hover</strong> for actions: Add subtask • Focus mode • Delete with descendants</p>
        </div>
      </div>
    </div>
  );
}
