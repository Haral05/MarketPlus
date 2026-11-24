import { DatePipe } from '@angular/common';
import {
  Component, ElementRef, HostListener, Injector, ViewChild,
  afterNextRender, computed, inject, signal,
} from '@angular/core';
import { GetProductService } from '../get-product-service';
import { PaymentMethod, Sale, SalesHistoryService } from '../sales-history-service';

type MethodFilter = 'all' | PaymentMethod;
type PresetId = 'today' | '7d' | '30d' | 'month' | 'all';
type ModalType = 'export' | 'delete';
type ExportFormat = 'txt' | 'csv' | 'xlsx' | 'pdf';

@Component({
  imports: [DatePipe],
  selector: 'app-history-component',
  styleUrl: './history-component.css',
  templateUrl: './history-component.html',
})
export class HistoryComponent {
  @ViewChild('modal') private modalRef!: ElementRef<HTMLDialogElement>;

  private readonly history = inject(SalesHistoryService);
  private readonly products = inject(GetProductService);
  private readonly injector = inject(Injector);

  protected readonly presets: { id: PresetId; label: string }[] = [
    { id: 'today', label: 'Today' },
    { id: '7d',    label: 'Last 7 days' },
    { id: '30d',   label: 'Last 30 days' },
    { id: 'month', label: 'This month' },
    { id: 'all',   label: 'All time' },
  ];

  protected readonly methodOptions: { value: MethodFilter; label: string }[] = [
    { value: 'all',  label: 'All payment methods' },
    { value: 'cash', label: 'Cash' },
    { value: 'card', label: 'Card' },
  ];

  protected readonly formats: { id: ExportFormat; label: string; description: string; icon: string; available: boolean }[] = [
    { id: 'txt',  label: 'Plain text (.txt)', description: 'Readable report with the sales list and details', icon: 'description',    available: true },
    { id: 'csv',  label: 'CSV (.csv)',        description: 'For spreadsheets and data tools',                 icon: 'table',          available: false },
    { id: 'xlsx', label: 'Excel (.xlsx)',     description: 'Formatted workbook with tabs',                    icon: 'grid_on',        available: false },
    { id: 'pdf',  label: 'PDF (.pdf)',        description: 'Print-ready document',                            icon: 'picture_as_pdf', available: false },
  ];

  // ═════════ Estado ═════════
  protected readonly dateFrom = signal('');          // 'yyyy-mm-dd' o ''
  protected readonly dateTo = signal('');
  protected readonly methodFilter = signal<MethodFilter>('all');
  protected readonly menuOpen = signal(false);

  protected readonly currentPage = signal(1);
  protected readonly pageSize = signal(10);
  private readonly selectedId = signal<string | null>(null);

  protected readonly modalType = signal<ModalType | null>(null);
  protected readonly target = signal<Sale | null>(null);        // venta a eliminar
  protected readonly exportFormat = signal<ExportFormat>('txt');
  protected readonly includeItems = signal(true);
  protected readonly restoreStock = signal(true);

  protected readonly toast = signal<string | null>(null);
  private toastTimer?: ReturnType<typeof setTimeout>;

  // ═════════ Derivados ═════════
  /** Resultado de aplicar rango de fechas + método de pago, de la más reciente a la más antigua. */
  protected readonly filtered = computed<Sale[]>(() => {
    const from = this.dateFrom();
    const to = this.dateTo();
    const method = this.methodFilter();
    return this.history.sales()
      .filter(s => {
        const day = this.dayKey(s.date);
        return (!from || day >= from) && (!to || day <= to) && (method === 'all' || s.method === method);
      })
      .sort((a, b) => b.date.getTime() - a.date.getTime());
  });

  protected readonly hasDemo = computed(() => this.history.sales().some(s => s.demo));
  protected readonly totalCount = computed(() => this.history.sales().length);

  protected readonly hasFilters = computed(() =>
    !!this.dateFrom() || !!this.dateTo() || this.methodFilter() !== 'all');

  protected readonly methodLabel = computed(() =>
    this.methodOptions.find(o => o.value === this.methodFilter())?.label ?? '');

  protected readonly activePreset = computed<PresetId | null>(() => {
    const from = this.dateFrom();
    const to = this.dateTo();
    for (const p of this.presets) {
      const [f, t] = this.presetRange(p.id);
      if (f === from && t === to) return p.id;
    }
    return null;
  });

  protected readonly summary = computed(() => {
    const list = this.filtered();
    const revenue = list.reduce((s, x) => s + x.total, 0);
    return {
      count: list.length,
      revenue,
      average: list.length ? revenue / list.length : 0,
      units: list.reduce((s, x) => s + this.itemCount(x), 0),
      cash: list.filter(x => x.method === 'cash').length,
      card: list.filter(x => x.method === 'card').length,
    };
  });

  protected readonly totalPages = computed(() =>
    Math.max(1, Math.ceil(this.filtered().length / this.pageSize())));

  /** Página efectiva: nunca se pasa del total (por ejemplo tras eliminar o filtrar). */
  protected readonly page = computed(() => Math.min(this.currentPage(), this.totalPages()));

  protected readonly visible = computed(() => {
    const start = (this.page() - 1) * this.pageSize();
    return this.filtered().slice(start, start + this.pageSize());
  });

  protected readonly range = computed(() => {
    const total = this.filtered().length;
    if (!total) return { from: 0, to: 0, total: 0 };
    const from = (this.page() - 1) * this.pageSize() + 1;
    return { from, to: from + this.visible().length - 1, total };
  });

  protected readonly visiblePages = computed<number[]>(() => {
    const total = this.totalPages();
    const current = this.page();
    if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
    if (current <= 4) return [1, 2, 3, 4, 5, -1, total];
    if (current >= total - 3) return [1, -1, total - 4, total - 3, total - 2, total - 1, total];
    return [1, -1, current - 1, current, current + 1, -1, total];
  });

  /** Venta mostrada en el panel: la elegida o, si no está en la lista filtrada, la primera. */
  protected readonly selected = computed<Sale | null>(() => {
    const list = this.filtered();
    return list.find(s => s.id === this.selectedId()) ?? list[0] ?? null;
  });

  // ═════════ Utilidades de formato ═════════
  protected money(n: number): string {
    return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  protected itemCount(s: Sale): number {
    return s.items.reduce((sum, it) => sum + it.qty, 0);
  }

  protected taxPct(s: Sale): number {
    return +(s.taxRate * 100).toFixed(2);
  }

  protected methodName(m: PaymentMethod): string {
    return m === 'cash' ? 'Cash' : 'Card';
  }

  private dayKey(d: Date): string {
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}-${mm}-${dd}`;
  }

  private addDays(d: Date, days: number): Date {
    const copy = new Date(d);
    copy.setDate(copy.getDate() + days);
    return copy;
  }

  private formatDay(key: string): string {
    return new Date(`${key}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  private formatStamp(d: Date): string {
    return d.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
  }

  // ═════════ Filtros ═════════
  private presetRange(id: PresetId): [string, string] {
    const now = new Date();
    const today = this.dayKey(now);
    switch (id) {
      case 'today': return [today, today];
      case '7d':    return [this.dayKey(this.addDays(now, -6)), today];
      case '30d':   return [this.dayKey(this.addDays(now, -29)), today];
      case 'month': return [this.dayKey(new Date(now.getFullYear(), now.getMonth(), 1)), today];
      default:      return ['', ''];
    }
  }

  protected setPreset(id: PresetId): void {
    const [from, to] = this.presetRange(id);
    this.dateFrom.set(from);
    this.dateTo.set(to);
    this.currentPage.set(1);
  }

  protected onFrom(value: string): void {
    this.dateFrom.set(value);
    if (value && this.dateTo() && value > this.dateTo()) this.dateTo.set(value);   // el rango nunca queda invertido
    this.currentPage.set(1);
  }

  protected onTo(value: string): void {
    this.dateTo.set(value);
    if (value && this.dateFrom() && value < this.dateFrom()) this.dateFrom.set(value);
    this.currentPage.set(1);
  }

  protected toggleMenu(event: Event): void {
    event.stopPropagation();
    this.menuOpen.update(v => !v);
  }

  @HostListener('document:click')
  @HostListener('document:keydown.escape')
  protected closeMenu(): void {
    if (this.menuOpen()) this.menuOpen.set(false);
  }

  protected selectMethod(value: MethodFilter): void {
    this.methodFilter.set(value);
    this.currentPage.set(1);
    this.menuOpen.set(false);
  }

  protected clearFilters(): void {
    this.dateFrom.set('');
    this.dateTo.set('');
    this.methodFilter.set('all');
    this.currentPage.set(1);
  }

  // ═════════ Lista y selección ═════════
  protected select(s: Sale): void {
    this.selectedId.set(s.id);
  }

  protected goToPage(p: number): void {
    if (p < 1 || p > this.totalPages()) return;
    this.currentPage.set(p);
  }
  protected nextPage(): void { this.goToPage(this.page() + 1); }
  protected prevPage(): void { this.goToPage(this.page() - 1); }

  protected removeDemo(): void {
    this.history.clearDemo();
    this.showToast('Sample data removed.');
  }

  // ═════════ Motor del modal (<dialog> nativo) ═════════
  private open(type: ModalType): void {
    this.modalType.set(type);
    const dlg = this.modalRef.nativeElement;
    if (!dlg.open) dlg.showModal();
    afterNextRender(
      () => dlg.querySelector<HTMLElement>('[data-autofocus]')?.focus(),
      { injector: this.injector },
    );
  }

  protected closeModal(): void {
    const dlg = this.modalRef.nativeElement;
    if (dlg.open) dlg.close();
  }

  protected onModalClosed(): void {
    this.modalType.set(null);
    this.target.set(null);
  }

  protected onBackdropClick(e: MouseEvent): void {
    if (e.target === this.modalRef.nativeElement) this.closeModal();
  }

  // ═════════ Eliminar venta ═════════
  protected openDelete(sale: Sale): void {
    this.target.set(sale);
    this.restoreStock.set(true);
    this.open('delete');
  }

  protected confirmDelete(): void {
    const sale = this.target();
    if (!sale) return;

    let restored = 0;
    if (this.restoreStock()) {
      for (const item of sale.items) {
        const product = this.products.getProductById(item.id);
        if (product) {
          product.total += item.qty;   // devuelve las unidades al inventario
          restored++;
        }
      }
    }

    this.history.remove(sale.id);
    this.closeModal();

    const stockNote = this.restoreStock()
      ? ` Stock restored for ${restored} of ${sale.items.length} product(s).`
      : '';
    this.showToast(`Sale #${sale.id} deleted.${stockNote}`);
  }

  // ═════════ Exportar ═════════
  protected openExport(): void {
    this.exportFormat.set('txt');
    this.open('export');
  }

  protected selectFormat(format: ExportFormat): void {
    if (this.formats.find(f => f.id === format)?.available) this.exportFormat.set(format);
  }

  protected exportHistory(): void {
    if (this.exportFormat() !== 'txt') return;   // el resto de formatos aún no está habilitado
    const list = this.filtered();
    if (!list.length) return;

    const name = `sales-history-${this.dayKey(new Date())}.txt`;
    this.downloadBlob(this.buildHistoryTxt(list), name);
    this.closeModal();
    this.showToast(`History exported: ${name}`);
  }

  protected downloadReceipt(sale: Sale): void {
    const name = `receipt-${sale.id}.txt`;
    this.downloadBlob(this.buildReceiptTxt(sale), name);
    this.showToast(`Receipt downloaded: ${name}`);
  }

  private buildHistoryTxt(list: Sale[]): string {
    const hr = '='.repeat(72);
    const sub = '-'.repeat(72);
    const L = (s: string, n: number) => s.padEnd(n);
    const R = (s: string, n: number) => s.padStart(n);
    const sum = (f: (s: Sale) => number) => list.reduce((t, s) => t + f(s), 0);

    const from = this.dateFrom();
    const to = this.dateTo();
    const period = !from && !to ? 'All dates'
      : `${from ? this.formatDay(from) : 'Beginning'} to ${to ? this.formatDay(to) : 'today'}`;
    const cash = list.filter(s => s.method === 'cash');
    const card = list.filter(s => s.method === 'card');
    const total = (a: Sale[]) => a.reduce((t, s) => t + s.total, 0);

    const out: string[] = [];
    out.push(hr, ' MARKETPLUS - SALES HISTORY', hr);
    out.push(`Generated : ${this.formatStamp(new Date())}`);
    out.push(`Period    : ${period}`);
    out.push(`Payment   : ${this.methodLabel()}`);
    out.push(`Sales     : ${list.length}`, '');

    out.push('SUMMARY', sub);
    out.push(`${L('Revenue', 22)}${R(this.money(total(list)), 14)}`);
    out.push(`${L('Average ticket', 22)}${R(this.money(total(list) / list.length), 14)}`);
    out.push(`${L('Discounts given', 22)}${R(this.money(sum(s => s.discount)), 14)}`);
    out.push(`${L('Tax collected', 22)}${R(this.money(sum(s => s.tax)), 14)}`);
    out.push(`${L('Units sold', 22)}${R(String(sum(s => this.itemCount(s))), 14)}`);
    out.push(`${L('Cash sales', 22)}${R(`${cash.length} (${this.money(total(cash))})`, 24)}`);
    out.push(`${L('Card sales', 22)}${R(`${card.length} (${this.money(total(card))})`, 24)}`, '');

    out.push('SALES', sub);
    out.push(`${L('ID', 11)}${L('Date / Time', 22)}${R('Items', 6)}  ${L('Payment', 9)}${R('Discount', 10)}${R('Total', 12)}`);
    for (const s of list) {
      out.push(
        `${L(s.id, 11)}${L(this.formatStamp(s.date), 22)}${R(String(this.itemCount(s)), 6)}  ` +
        `${L(this.methodName(s.method), 9)}${R(this.money(s.discount), 10)}${R(this.money(s.total), 12)}`,
      );
    }
    out.push(sub, `${L('TOTAL', 49)}${R(this.money(sum(s => s.discount)), 10)}${R(this.money(total(list)), 12)}`, '');

    if (this.includeItems()) {
      out.push('SALE DETAILS', sub);
      for (const s of list) {
        out.push(`#${s.id}  |  ${this.formatStamp(s.date)}  |  ${this.methodName(s.method)}`);
        for (const it of s.items) {
          out.push(`   ${L(it.name, 22)}${R(`${it.qty} x ${this.money(it.price)}`, 18)}${R(this.money(it.qty * it.price), 12)}`);
        }
        out.push(`   ${L('Subtotal', 22)}${R(this.money(s.subtotal), 30)}`);
        if (s.discount > 0) out.push(`   ${L('Discount', 22)}${R('-' + this.money(s.discount), 30)}`);
        out.push(`   ${L(`Tax (${this.taxPct(s)}%)`, 22)}${R(this.money(s.tax), 30)}`);
        out.push(`   ${L('TOTAL', 22)}${R(this.money(s.total), 30)}`, '');
      }
    }

    out.push(hr, ' End of report', hr, '');
    return out.join('\r\n');
  }

  private buildReceiptTxt(s: Sale): string {
    const hr = '='.repeat(44);
    const L = (t: string, n: number) => t.padEnd(n);
    const R = (t: string, n: number) => t.padStart(n);
    const out: string[] = [];

    out.push(hr, '               MARKETPLUS', hr);
    out.push(`Receipt  : #${s.id}`);
    out.push(`Date     : ${this.formatStamp(s.date)}`);
    out.push(`Payment  : ${this.methodName(s.method)}`, '-'.repeat(44));
    for (const it of s.items) {
      out.push(`${L(it.name, 24)}${R(`${it.qty} x ${this.money(it.price)}`, 12)}${R(this.money(it.qty * it.price), 8)}`.slice(0, 60));
    }
    out.push('-'.repeat(44));
    out.push(`${L('Subtotal', 24)}${R(this.money(s.subtotal), 20)}`);
    if (s.discount > 0) out.push(`${L('Discount', 24)}${R('-' + this.money(s.discount), 20)}`);
    out.push(`${L(`Tax (${this.taxPct(s)}%)`, 24)}${R(this.money(s.tax), 20)}`);
    out.push(`${L('TOTAL', 24)}${R(this.money(s.total), 20)}`);
    if (s.method === 'cash' && s.cashReceived !== null) {
      out.push(`${L('Cash received', 24)}${R(this.money(s.cashReceived), 20)}`);
      out.push(`${L('Change', 24)}${R(this.money(s.change), 20)}`);
    }
    out.push(hr, '           Thank you for your purchase!', hr, '');
    return out.join('\r\n');
  }

  // ═════════ Utilidades ═════════
  private downloadBlob(content: string, filename: string): void {
    const url = URL.createObjectURL(new Blob([content], { type: 'text/plain;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  private showToast(text: string): void {
    clearTimeout(this.toastTimer);
    this.toast.set(text);
    this.toastTimer = setTimeout(() => this.toast.set(null), 4000);
  }
}