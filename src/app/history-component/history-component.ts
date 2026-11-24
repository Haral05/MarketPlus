import { DatePipe } from '@angular/common';
import {
  Component, ElementRef, HostListener, Injector, ViewChild,
  afterNextRender, computed, inject, signal,
} from '@angular/core';
import { GetProductService } from '../get-product-service';
import { PaymentMethod, Sale, SalesHistoryService } from '../sales-history-service';

type MethodFilter = 'all' | PaymentMethod;
type PresetId = 'today' | '7d' | '30d' | 'month' | 'all';
type ModalType = 'export' | 'delete' | 'refund';
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
  protected readonly query = signal('');
  protected readonly dateFrom = signal('');          // 'yyyy-mm-dd' o ''
  protected readonly dateTo = signal('');
  protected readonly methodFilter = signal<MethodFilter>('all');
  protected readonly menuOpen = signal(false);

  protected readonly currentPage = signal(1);
  protected readonly pageSize = signal(10);
  private readonly selectedId = signal<string | null>(null);

  protected readonly modalType = signal<ModalType | null>(null);
  protected readonly target = signal<Sale | null>(null);        // venta a eliminar o reembolsar
  protected readonly exportFormat = signal<ExportFormat>('txt');
  protected readonly includeItems = signal(true);
  protected readonly restoreStock = signal(true);

  protected readonly toast = signal<string | null>(null);
  private toastTimer?: ReturnType<typeof setTimeout>;

  // ═════════ Derivados ═════════
  /** Búsqueda + rango de fechas + método de pago, de la más reciente a la más antigua. */
  protected readonly filtered = computed<Sale[]>(() => {
    const q = this.query().trim().toLowerCase().replace(/^#/, '');
    const from = this.dateFrom();
    const to = this.dateTo();
    const method = this.methodFilter();
    return this.history.sales()
      .filter(s => {
        const day = this.dayKey(s.date);
        return (!from || day >= from)
          && (!to || day <= to)
          && (method === 'all' || s.method === method)
          && (!q || this.matches(s, q));
      })
      .sort((a, b) => b.date.getTime() - a.date.getTime());
  });

  protected readonly hasDemo = computed(() => this.history.sales().some(s => s.demo));
  protected readonly totalCount = computed(() => this.history.sales().length);

  protected readonly hasFilters = computed(() =>
    !!this.query().trim() || !!this.dateFrom() || !!this.dateTo() || this.methodFilter() !== 'all');

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

  /** Los ingresos solo cuentan las ventas completadas; las reembolsadas se muestran aparte. */
  protected readonly summary = computed(() => {
    const list = this.filtered();
    const done = list.filter(s => s.status === 'completed');
    const refunded = list.filter(s => s.status === 'refunded');
    const revenue = done.reduce((s, x) => s + x.total, 0);
    return {
      count: done.length,
      revenue,
      average: done.length ? revenue / done.length : 0,
      cash: done.filter(x => x.method === 'cash').length,
      card: done.filter(x => x.method === 'card').length,
      refundedCount: refunded.length,
      refundedAmount: refunded.reduce((s, x) => s + x.total, 0),
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

  // ═════════ Formato y utilidades ═════════
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

  protected statusName(s: Sale): string {
    return s.status === 'completed' ? 'COMPLETED' : 'REFUNDED';
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

  /** Busca por ID de transacción (con o sin '#'), nombre de producto o ID de producto. */
  private matches(s: Sale, q: string): boolean {
    return s.id.toLowerCase().includes(q)
      || s.items.some(it => it.name.toLowerCase().includes(q) || String(it.id) === q);
  }

  // ═════════ Búsqueda y filtros ═════════
  protected onSearch(value: string): void {
    this.query.set(value);
    this.currentPage.set(1);
  }

  protected clearSearch(): void {
    this.query.set('');
    this.currentPage.set(1);
  }

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
    this.query.set('');
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

  // ═════════ Reembolsar ═════════
  protected openRefund(sale: Sale): void {
    if (sale.status !== 'completed') return;
    this.target.set(sale);
    this.restoreStock.set(true);
    this.open('refund');
  }

  protected confirmRefund(): void {
    const sale = this.target();
    if (!sale || sale.status !== 'completed') return;

    const restored = this.restoreStock() ? this.returnToStock(sale) : null;
    this.history.refund(sale.id);
    this.closeModal();

    const note = restored ? ` Stock restored for ${restored.done} of ${sale.items.length} product(s).` : '';
    this.showToast(`Sale #${sale.id} refunded.${note}`);
  }

  // ═════════ Eliminar ═════════
  protected openDelete(sale: Sale): void {
    this.target.set(sale);
    this.restoreStock.set(true);
    this.open('delete');
  }

  protected confirmDelete(): void {
    const sale = this.target();
    if (!sale) return;

    // Una venta ya reembolsada no vuelve a tocar el stock (ya se gestionó al reembolsar)
    const restored = sale.status === 'completed' && this.restoreStock() ? this.returnToStock(sale) : null;
    this.history.remove(sale.id);
    this.closeModal();

    const note = restored ? ` Stock restored for ${restored.done} of ${sale.items.length} product(s).` : '';
    this.showToast(`Sale #${sale.id} deleted.${note}`);
  }

  /** Devuelve las unidades de la venta al inventario (por ID de producto). */
  private returnToStock(sale: Sale): { done: number } {
    let done = 0;
    for (const item of sale.items) {
      const product = this.products.getProductById(item.id);
      if (product) {
        product.total += item.qty;
        done++;
      }
    }
    return { done };
  }

  // ═════════ Imprimir recibo ═════════
  protected printReceipt(sale: Sale): void {
    this.printHtml(this.buildReceiptHtml(sale));
  }

  private esc(text: string): string {
    return text
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  private buildReceiptHtml(s: Sale): string {
    const rows = s.items.map(it => `
        <tr>
          <td>${this.esc(it.name)}<small>${it.qty} x ${this.money(it.price)}</small></td>
          <td class="r">${this.money(it.qty * it.price)}</td>
        </tr>`).join('');

    const extra = s.method === 'cash' && s.cashReceived !== null
      ? `<tr><td>Cash received</td><td class="r">${this.money(s.cashReceived)}</td></tr>
         <tr><td>Change</td><td class="r">${this.money(s.change)}</td></tr>`
      : '';

    const stamp = s.status === 'refunded'
      ? `<div class="stamp">REFUNDED${s.refundedAt ? `<small>${this.esc(this.formatStamp(s.refundedAt))}</small>` : ''}</div>`
      : '';

    return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Receipt ${this.esc(s.id)}</title>
<style>
  @page { margin: 4mm; }
  * { box-sizing: border-box; }
  body { margin: 0 auto; width: 72mm; font: 12px/1.45 'Courier New', monospace; color: #000; background: #fff; }
  h1 { margin: 0 0 2px; font-size: 18px; letter-spacing: 2px; text-align: center; }
  .c { text-align: center; }
  .r { text-align: right; white-space: nowrap; padding-left: 8px; }
  hr { border: 0; border-top: 1px dashed #000; margin: 8px 0; }
  table { width: 100%; border-collapse: collapse; }
  td { padding: 2px 0; vertical-align: top; }
  small { display: block; font-size: 11px; }
  .total td { padding-top: 4px; font-size: 15px; font-weight: 700; }
  .stamp { margin: 10px 0; padding: 4px; border: 2px solid #000; text-align: center; font-weight: 700; letter-spacing: 3px; }
</style></head>
<body>
  <h1>MARKETPLUS</h1>
  <p class="c">Sales receipt</p>
  <hr>
  <table>
    <tr><td>Receipt</td><td class="r">#${this.esc(s.id)}</td></tr>
    <tr><td>Date</td><td class="r">${this.esc(this.formatStamp(s.date))}</td></tr>
    <tr><td>Payment</td><td class="r">${this.methodName(s.method)}</td></tr>
  </table>
  <hr>
  <table>${rows}</table>
  <hr>
  <table>
    <tr><td>Subtotal</td><td class="r">${this.money(s.subtotal)}</td></tr>
    ${s.discount > 0 ? `<tr><td>Discount</td><td class="r">-${this.money(s.discount)}</td></tr>` : ''}
    <tr><td>Tax (${this.taxPct(s)}%)</td><td class="r">${this.money(s.tax)}</td></tr>
    <tr class="total"><td>TOTAL</td><td class="r">${this.money(s.total)}</td></tr>
    ${extra}
  </table>
  ${stamp}
  <hr>
  <p class="c">Thank you for your purchase!</p>
</body></html>`;
  }

  /** Imprime HTML en un iframe oculto: no abre pestañas nuevas ni choca con bloqueadores de ventanas. */
  private printHtml(html: string): void {
    const frame = document.createElement('iframe');
    frame.setAttribute('aria-hidden', 'true');
    frame.setAttribute('title', 'Receipt');
    frame.style.cssText = 'position:fixed;left:-10000px;top:0;width:320px;height:640px;border:0;';
    document.body.appendChild(frame);

    const doc = frame.contentDocument;
    const win = frame.contentWindow;
    if (!doc || !win) { frame.remove(); return; }

    doc.open();
    doc.write(html);
    doc.close();

    const cleanup = () => setTimeout(() => frame.remove(), 500);
    win.onafterprint = cleanup;
    setTimeout(() => {              // deja que el iframe termine de maquetar antes de imprimir
      win.focus();
      win.print();
      setTimeout(() => frame.remove(), 60_000);   // red de seguridad si el navegador no avisa del fin de impresión
    }, 250);
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

  private buildHistoryTxt(list: Sale[]): string {
    const hr = '='.repeat(78);
    const sub = '-'.repeat(78);
    const L = (s: string, n: number) => s.padEnd(n);
    const R = (s: string, n: number) => s.padStart(n);

    const done = list.filter(s => s.status === 'completed');
    const refunded = list.filter(s => s.status === 'refunded');
    const sum = (a: Sale[], f: (s: Sale) => number) => a.reduce((t, s) => t + f(s), 0);
    const cash = done.filter(s => s.method === 'cash');
    const card = done.filter(s => s.method === 'card');
    const revenue = sum(done, s => s.total);

    const from = this.dateFrom();
    const to = this.dateTo();
    const period = !from && !to ? 'All dates'
      : `${from ? this.formatDay(from) : 'Beginning'} to ${to ? this.formatDay(to) : 'today'}`;
    const q = this.query().trim();

    const out: string[] = [];
    out.push(hr, ' MARKETPLUS - SALES HISTORY', hr);
    out.push(`Generated : ${this.formatStamp(new Date())}`);
    out.push(`Period    : ${period}`);
    out.push(`Payment   : ${this.methodOptions.find(o => o.value === this.methodFilter())?.label}`);
    if (q) out.push(`Search    : "${q}"`);
    out.push(`Records   : ${list.length} (${done.length} completed, ${refunded.length} refunded)`, '');

    out.push('SUMMARY (completed sales only)', sub);
    out.push(`${L('Net revenue', 24)}${R(this.money(revenue), 14)}`);
    out.push(`${L('Average ticket', 24)}${R(this.money(done.length ? revenue / done.length : 0), 14)}`);
    out.push(`${L('Discounts given', 24)}${R(this.money(sum(done, s => s.discount)), 14)}`);
    out.push(`${L('Tax collected', 24)}${R(this.money(sum(done, s => s.tax)), 14)}`);
    out.push(`${L('Units sold', 24)}${R(String(sum(done, s => this.itemCount(s))), 14)}`);
    out.push(`${L('Cash sales', 24)}${R(`${cash.length} (${this.money(sum(cash, s => s.total))})`, 26)}`);
    out.push(`${L('Card sales', 24)}${R(`${card.length} (${this.money(sum(card, s => s.total))})`, 26)}`);
    out.push(`${L('Refunded (excluded)', 24)}${R(`${refunded.length} (${this.money(sum(refunded, s => s.total))})`, 26)}`, '');

    out.push('SALES', sub);
    out.push(`${L('ID', 12)}${L('Date / Time', 22)}${R('Items', 6)}  ${L('Payment', 9)}${L('Status', 10)}${R('Total', 12)}`);
    for (const s of list) {
      out.push(
        `${L(s.id, 12)}${L(this.formatStamp(s.date), 22)}${R(String(this.itemCount(s)), 6)}  ` +
        `${L(this.methodName(s.method), 9)}${L(s.status.toUpperCase(), 10)}${R(this.money(s.total), 12)}`,
      );
    }
    out.push(sub, `${L('NET REVENUE (completed only)', 66)}${R(this.money(revenue), 12)}`, '');

    if (this.includeItems()) {
      out.push('SALE DETAILS', sub);
      for (const s of list) {
        const refundNote = s.status === 'refunded' && s.refundedAt ? `  |  REFUNDED ${this.formatStamp(s.refundedAt)}` : '';
        out.push(`#${s.id}  |  ${this.formatStamp(s.date)}  |  ${this.methodName(s.method)}${refundNote}`);
        for (const it of s.items) {
          out.push(`   ${L(it.name, 24)}${R(`${it.qty} x ${this.money(it.price)}`, 18)}${R(this.money(it.qty * it.price), 12)}`);
        }
        out.push(`   ${L('Subtotal', 24)}${R(this.money(s.subtotal), 30)}`);
        if (s.discount > 0) out.push(`   ${L('Discount', 24)}${R('-' + this.money(s.discount), 30)}`);
        out.push(`   ${L(`Tax (${this.taxPct(s)}%)`, 24)}${R(this.money(s.tax), 30)}`);
        out.push(`   ${L('TOTAL', 24)}${R(this.money(s.total), 30)}`, '');
      }
    }

    out.push(hr, ' End of report', hr, '');
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
    this.toastTimer = setTimeout(() => this.toast.set(null), 4500);
  }
}

