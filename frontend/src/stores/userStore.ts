import { create } from "zustand";

export interface User {
  id: string;
  name: string;
  email: string;
  color: string;
}

interface UserStore {
  users: User[];
  currentUser: User | null;
  setUsers: (users: User[]) => void;
  switchUser: (user: User) => void;
}

export const useUserStore = create<UserStore>((set) => ({
  users: [],
  currentUser: null,
  setUsers: (users) => set({ users }),
  switchUser: (user) => {
    localStorage.setItem("userId", user.id);
    set({ currentUser: user });
  },
}));
