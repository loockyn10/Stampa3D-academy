export interface CourseModule {
  title: string;
  done: boolean;
  locked?: boolean;
}

export interface Course {
  id: string;
  title: string;
  lessons: number;
  duration: string;
  progress: number;
  badge: 'Disponible' | 'Premium' | string;
  img: string; // Emojis or images
  desc: string;
  modules: CourseModule[];
}

export interface StlCategory {
  id: string;
  name: string;
  icon: string;
  count: number;
}

export interface StlFile {
  id: string;
  name: string;
  cat: string;
  badge: 'Gratis' | 'Premium' | string;
  img: string;
}

export interface Winner {
  name: string;
  prize: string;
  date: string;
}

export interface Product {
  id: string;
  name: string;
  cat: string;
  material: string;
  time: string;
  cost: number;
  price: number;
  stock: number;
  img: string;
}

export interface StockItem {
  name: string;
  cat: 'Producto' | 'Filamento' | string;
  qty: number;
  unit: 'u' | 'kg' | string;
  loc: string;
  low: boolean;
  chip?: number; // Optional index for spool color
}

export interface Budget {
  id: string;
  client: string;
  items: string;
  total: number;
  status: 'Aprobado' | 'Enviado' | 'Borrador' | 'Rechazado';
}

export interface NavItem {
  id: string;
  label: string;
  icon: React.ComponentType<any>;
}

export interface NavGroup {
  group: string;
  items: NavItem[];
}
