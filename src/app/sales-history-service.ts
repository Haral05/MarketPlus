import { Injectable, effect, signal } from '@angular/core';

export type PaymentMethod = 'cash' | 'card';
export type SaleStatus = 'completed' | 'refunded';

export interface SaleItem {
  id: number;       // ID / código de barras del producto
  name: string;
  price: number;    // precio unitario en el momento de la venta
  qty: number;
}

export interface Sale {
  id: string;                    // 'TRX-00012' (las de ejemplo: 'DEMO-00012')
  number: number;
  date: Date;
  items: SaleItem[];
  subtotal: number;
  discount: number;
  taxRate: number;               // fracción: 0.0825 = 8.25 %
  tax: number;
  total: number;
  method: PaymentMethod;
  cashReceived: number | null;
  change: number;
  status: SaleStatus;
  refundedAt?: Date;
  demo?: boolean;                // true = dato de ejemplo
}

/** Lo que necesita Sales para registrar una venta. */
export interface NewSale {
  items: SaleItem[];
  subtotal: number;
  discount: number;
  taxRate: number;
  tax: number;
  total: number;
  method: PaymentMethod;
  cashReceived: number | null;
}

interface StoredHistory {
  version?: number;
  next: number;
  demoRemoved?: boolean;
  sales: Sale[];   // las fechas se guardan como texto ISO y se reconvierten al cargar
}

const STORAGE_KEY = 'marketplus-sales-history';

/** Pon esto en false si no quieres datos de ejemplo. */
const SEED_DEMO = true;

/**
 * Sube este número cuando cambies los datos de ejemplo:
 * al cargar, las ventas de ejemplo antiguas se sustituyen por las nuevas
 * y las ventas reales NO se tocan.
 */
const SEED_VERSION = 2;

@Injectable({ providedIn: 'root' })
export class SalesHistoryService {
  private next = 1;
  private demoRemoved = false;

  readonly sales = signal<Sale[]>(this.load());

  constructor() {
    // Guarda cada cambio (venta nueva, reembolso, eliminación...)
    effect(() => {
      const sales = this.sales();
      const data: StoredHistory = {
        version: SEED_VERSION,
        next: this.next,
        demoRemoved: this.demoRemoved,
        sales,
      };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      } catch { /* almacenamiento no disponible */ }
    });
  }

  /** Registra una venta completada. Lo llama el componente de Sales al confirmar el pago. */
  record(input: NewSale): Sale {
    const number = this.next++;
    const change = input.method === 'cash' && input.cashReceived !== null
      ? Math.max(0, this.round2(input.cashReceived - input.total))
      : 0;

    const sale: Sale = {
      ...input,
      id: `TRX-${String(number).padStart(5, '0')}`,
      number,
      date: new Date(),
      change,
      status: 'completed',
    };
    this.sales.update(list => [sale, ...list]);
    return sale;
  }

  /** Marca la venta como reembolsada: se conserva en el historial pero deja de contar como ingreso. */
  refund(id: string): void {
    this.sales.update(list => list.map(s =>
      s.id === id && s.status === 'completed'
        ? { ...s, status: 'refunded' as const, refundedAt: new Date() }
        : s));
  }

  /** Borra la venta del historial (para errores de registro). */
  remove(id: string): void {
    this.sales.update(list => list.filter(s => s.id !== id));
  }

  clearDemo(): void {
    this.demoRemoved = true;
    this.sales.update(list => list.filter(s => !s.demo));
  }

  // ───────── Carga ─────────
  private revive(s: Sale): Sale {
    return {
      ...s,
      date: new Date(s.date),
      status: s.status ?? 'completed',                       // ventas guardadas antes de existir los reembolsos
      refundedAt: s.refundedAt ? new Date(s.refundedAt) : undefined,
    };
  }

  private load(): Sale[] {
    let stored: StoredHistory | null = null;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) stored = JSON.parse(raw) as StoredHistory;
    } catch { /* se ignora */ }

    if (stored) {
      this.next = stored.next ?? 1;
      this.demoRemoved = stored.demoRemoved ?? false;
      let sales = (stored.sales ?? []).map(s => this.revive(s));

      // Cambió la versión de los datos de ejemplo: se renuevan (las ventas reales no se tocan)
      if (stored.version !== SEED_VERSION) {
        sales = sales.filter(s => !s.demo);
        if (SEED_DEMO && !this.demoRemoved) sales = [...sales, ...this.seed()];
      }
      return sales;
    }

    return SEED_DEMO ? this.seed() : [];
  }

  private round2(n: number): number {
    return Math.round((n + Number.EPSILON) * 100) / 100;
  }

  /** Ventas de ejemplo, siempre las mismas (generador pseudoaleatorio con semilla fija). */
  private seed(): Sale[] {
    const catalog: { id: number; name: string; price: number }[] = [
      { id: 900001, name: 'Azucar',   price: 1.85 },
      { id: 900002, name: 'Arroz',    price: 1.5 },
      { id: 900003, name: 'Aceite',   price: 4.2 },
      { id: 900004, name: 'Leche',    price: 1.1 },
      { id: 900005, name: 'Boniato',  price: 1.6 },
      { id: 900006, name: 'Calabaza', price: 1.3 },
      { id: 900007, name: 'Cafe',     price: 6.5 },
      { id: 900008, name: 'Pan',      price: 0.9 },
    ];

    let seed = 20260101;
    const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
    const now = new Date();

    const dates = Array.from({ length: 60 }, () => {
      const date = new Date(now);
      date.setDate(date.getDate() - Math.floor(rnd() * 75));      // 0 = hoy
      date.setHours(8 + Math.floor(rnd() * 12), Math.floor(rnd() * 60), Math.floor(rnd() * 60), 0);
      if (date.getTime() > now.getTime()) date.setTime(now.getTime() - 60_000 * (1 + Math.floor(rnd() * 90)));
      return date;
    }).sort((a, b) => a.getTime() - b.getTime());

    return dates.map((date, i) => {
      const pool = [...catalog];
      const count = 1 + Math.floor(rnd() * 4);
      const items: SaleItem[] = [];
      for (let k = 0; k < count; k++) {
        const p = pool.splice(Math.floor(rnd() * pool.length), 1)[0];
        items.push({ id: p.id, name: p.name, price: p.price, qty: 1 + Math.floor(rnd() * 5) });
      }

      const subtotal = this.round2(items.reduce((s, it) => s + it.price * it.qty, 0));
      const discount = rnd() < 0.2 ? this.round2(subtotal * 0.1) : 0;
      const taxRate = 0.0825;
      const tax = this.round2((subtotal - discount) * taxRate);
      const total = this.round2(subtotal - discount + tax);
      const method: PaymentMethod = rnd() < 0.55 ? 'card' : 'cash';
      const cashReceived = method === 'cash' ? Math.ceil(total / 5) * 5 : null;
      const number = i + 1;
      const refunded = i % 9 === 4;   // algunas ventas de ejemplo ya reembolsadas

      return {
        id: `DEMO-${String(number).padStart(5, '0')}`,
        number,
        date,
        items,
        subtotal,
        discount,
        taxRate,
        tax,
        total,
        method,
        cashReceived,
        change: cashReceived !== null ? this.round2(cashReceived - total) : 0,
        status: refunded ? 'refunded' : 'completed',
        refundedAt: refunded ? new Date(Math.min(date.getTime() + 2 * 3_600_000, now.getTime())) : undefined,
        demo: true,
      } as Sale;
    });
  }
}