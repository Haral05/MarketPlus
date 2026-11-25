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

      
      return sales;
    }

    return [];
  }

  private round2(n: number): number {
    return Math.round((n + Number.EPSILON) * 100) / 100;
  }

  
}