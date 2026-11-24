import { DatePipe } from '@angular/common';
import {
  AfterViewInit, Component, ElementRef, HostListener, OnDestroy, ViewChild, computed, inject, signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { Chart, Plugin, registerables } from 'chart.js';
import { Sale, SalesHistoryService } from '../sales-history-service';

Chart.register(...registerables);

type TopMode = 'volume' | 'revenue';
type ExportFormat = 'txt' | 'csv' | 'xlsx' | 'pdf';

interface Metric {
  label: string;
  icon: string;
  value: string;
  delta: number | null;   // % frente a ayer (null = ayer no hubo datos con los que comparar)
  deltaLabel: string;
  hint: string;
}

interface Activity {
  id: string;
  when: string;
  method: 'Card' | 'Cash';
  items: number;
  amount: number;
  status: 'completed' | 'refunded';
}

interface TopProduct {
  name: string;
  units: number;
  revenue: number;
}

interface WeekRow {
  day: string;
  current: number | null;    // null = día que aún no ha llegado
  previous: number;
  change: number | null;
}

interface ChartPalette {
  primary: string;
  text: string;
  muted: string;
  border: string;
  surface: string;
  bg: string;
}

@Component({
  imports: [DatePipe, RouterLink],
  selector: 'app-dashboard-component',
  styleUrl: './dashboard-component.css',
  templateUrl: './dashboard-component.html',
})
export class DashboardComponent implements AfterViewInit, OnDestroy {
  protected fecha = new Date();

  @ViewChild('miGrafica') miGrafica!: ElementRef<HTMLCanvasElement>;
  @ViewChild('miGraficaBarras') miGraficaBarras!: ElementRef<HTMLCanvasElement>;
  @ViewChild('exportModal') private exportRef!: ElementRef<HTMLDialogElement>;

  private readonly history = inject(SalesHistoryService);

  private chartLinea?: Chart;
  private chartBarras?: Chart;
  private themeObserver?: MutationObserver;
  private toastTimer?: ReturnType<typeof setTimeout>;

  private readonly days: string[] = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  // ═════════ Estado (signals) ═════════
  protected readonly topMode = signal<TopMode>('volume');
  protected readonly showTable = signal(false);
  protected readonly trendMenu = signal(false);
  protected readonly exportFormat = signal<ExportFormat>('txt');
  protected readonly toast = signal<string | null>(null);

  protected readonly formats: { id: ExportFormat; label: string; description: string; icon: string; available: boolean }[] = [
    { id: 'txt',  label: 'Plain text (.txt)', description: 'Readable report with every section', icon: 'description',    available: true },
    { id: 'csv',  label: 'CSV (.csv)',        description: 'For spreadsheets and data tools',    icon: 'table',          available: false },
    { id: 'xlsx', label: 'Excel (.xlsx)',     description: 'Formatted workbook with tabs',       icon: 'grid_on',        available: false },
    { id: 'pdf',  label: 'PDF (.pdf)',        description: 'Print-ready document with charts',   icon: 'picture_as_pdf', available: false },
  ];

  // ═════════ Datos reales (derivados del historial de ventas) ═════════
  /** Las ventas reembolsadas no cuentan como ingreso. */
  private readonly completed = computed<Sale[]>(() =>
    this.history.sales().filter(s => s.status === 'completed'));

  private readonly revenueByDay = computed(() => {
    const map = new Map<string, number>();
    for (const s of this.completed()) {
      const key = this.dayKey(s.date);
      map.set(key, (map.get(key) ?? 0) + s.total);
    }
    return map;
  });

  protected readonly metrics = computed<Metric[]>(() => {
    const now = new Date();
    const todayKey = this.dayKey(now);
    const yesterdayKey = this.dayKey(this.addDays(now, -1));

    const on = (key: string) => this.completed().filter(s => this.dayKey(s.date) === key);
    const sum = (list: Sale[], f: (s: Sale) => number) => list.reduce((n, s) => n + f(s), 0);
    const delta = (cur: number, prev: number) => (prev > 0 ? ((cur - prev) / prev) * 100 : null);

    const today = on(todayKey);
    const yesterday = on(yesterdayKey);

    const revenue = sum(today, s => s.total);
    const revenueY = sum(yesterday, s => s.total);
    const cash = today.filter(s => s.method === 'cash').length;
    const cashY = yesterday.filter(s => s.method === 'cash').length;
    const units = sum(today, s => this.units(s));
    const unitsY = sum(yesterday, s => this.units(s));
    const refundedToday = this.history.sales()
      .filter(s => s.status === 'refunded' && this.dayKey(s.date) === todayKey).length;

    return [
      {
        label: 'Total sales today', icon: 'attach_money', value: this.money(revenue),
        delta: delta(revenue, revenueY), deltaLabel: 'vs yesterday',
        hint: today.length ? `Avg. ticket ${this.money(revenue / today.length)}` : 'No sales yet today',
      },
      {
        label: 'Transactions', icon: 'swap_horiz', value: String(today.length),
        delta: delta(today.length, yesterday.length), deltaLabel: 'vs yesterday',
        hint: refundedToday ? `${refundedToday} refunded today` : 'No refunds today',
      },
      {
        label: 'Cash payments', icon: 'payments', value: String(cash),
        delta: delta(cash, cashY), deltaLabel: 'vs yesterday',
        hint: today.length ? `${Math.round((cash / today.length) * 100)}% of today's sales` : 'No sales yet today',
      },
      {
        label: 'Items sold', icon: 'shopping_bag', value: String(units),
        delta: delta(units, unitsY), deltaLabel: 'vs yesterday',
        hint: today.length ? `Avg. ${(units / today.length).toFixed(1)} per sale` : 'No sales yet today',
      },
    ];
  });

  /** Semana en curso (lunes a domingo) frente a la anterior. */
  protected readonly weekSummary = computed(() => {
    const byDay = this.revenueByDay();
    const now = new Date();
    const start = this.startOfWeek(now);
    const todayIdx = (now.getDay() + 6) % 7;          // lunes = 0

    const keys = (from: Date) => this.days.map((_, i) => this.dayKey(this.addDays(from, i)));
    const currentKeys = keys(start);
    const previousKeys = keys(this.addDays(start, -7));

    const current: (number | null)[] = currentKeys.map((k, i) => (i <= todayIdx ? this.round2(byDay.get(k) ?? 0) : null));
    const previous: number[] = previousKeys.map(k => this.round2(byDay.get(k) ?? 0));

    const total = current.reduce<number>((s, n) => s + (n ?? 0), 0);
    const lastTotal = previous.reduce((s, n) => s + n, 0);
    const lastSameDays = previous.slice(0, todayIdx + 1).reduce((s, n) => s + n, 0);

    let bestIdx = 0;
    current.forEach((v, i) => { if ((v ?? 0) > (current[bestIdx] ?? 0)) bestIdx = i; });

    const rows: WeekRow[] = this.days.map((day, i) => ({
      day,
      current: current[i],
      previous: previous[i],
      change: current[i] !== null && previous[i] > 0 ? (((current[i] as number) - previous[i]) / previous[i]) * 100 : null,
    }));

    return {
      current,
      previous,
      rows,
      total,
      lastTotal,
      daysElapsed: todayIdx + 1,
      average: total / (todayIdx + 1),
      bestDay: total > 0 ? this.days[bestIdx] : '—',
      bestValue: total > 0 ? (current[bestIdx] ?? 0) : 0,
      change: lastSameDays > 0 ? ((total - lastSameDays) / lastSameDays) * 100 : null,   // mismos días de la semana pasada
    };
  });

  /** Productos de los últimos 30 días (ventas completadas). */
  private readonly productStats = computed<TopProduct[]>(() => {
    const cutoff = this.dayKey(this.addDays(new Date(), -29));
    const map = new Map<number, TopProduct>();
    for (const s of this.completed()) {
      if (this.dayKey(s.date) < cutoff) continue;
      for (const it of s.items) {
        const cur = map.get(it.id) ?? { name: it.name, units: 0, revenue: 0 };
        cur.name = it.name;
        cur.units += it.qty;
        cur.revenue += it.qty * it.price;
        map.set(it.id, cur);
      }
    }
    return [...map.values()];
  });

  protected readonly topSorted = computed<TopProduct[]>(() => {
    const key = this.topMode() === 'volume' ? 'units' : 'revenue';
    return [...this.productStats()].sort((a, b) => b[key] - a[key]).slice(0, 5);
  });

  protected readonly topTotals = computed(() => {
    const list = this.topSorted();
    return {
      units: list.reduce((s, t) => s + t.units, 0),
      revenue: list.reduce((s, t) => s + t.revenue, 0),
    };
  });

  protected readonly recent = computed<Activity[]>(() =>
    [...this.history.sales()]
      .sort((a, b) => b.date.getTime() - a.date.getTime())
      .slice(0, 6)
      .map(s => ({
        id: s.id,
        when: this.formatWhen(s.date),
        method: s.method === 'cash' ? 'Cash' as const : 'Card' as const,
        items: this.units(s),
        amount: s.total,
        status: s.status,
      })));

  protected readonly recentSummary = computed(() => {
    const list = this.recent();
    if (!list.length) return 'No sales yet';
    const refunded = list.filter(t => t.status === 'refunded').length;
    const paid = list.filter(t => t.status === 'completed').reduce((s, t) => s + t.amount, 0);
    return `Last ${list.length} sales · ${refunded} refunded · ${this.money(paid)} paid`;
  });

  // ═════════ Ciclo de vida ═════════
  ngAfterViewInit(): void {
    this.createCharts();

    // Los gráficos son <canvas>: no leen variables CSS solos.
    // Si cambia el tema (<html data-theme>), se vuelven a dibujar con la paleta nueva.
    this.themeObserver = new MutationObserver(() => {
      this.destroyCharts();
      this.createCharts();
    });
    this.themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  }

  ngOnDestroy(): void {
    this.destroyCharts();
    this.themeObserver?.disconnect();
    clearTimeout(this.toastTimer);
  }

  // ═════════ Utilidades de fecha y formato ═════════
  protected money(n: number): string {
    return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  protected pct(n: number | null): string {
    return n === null ? '—' : `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`;
  }

  private round2(n: number): number {
    return Math.round((n + Number.EPSILON) * 100) / 100;
  }

  private units(s: Sale): number {
    return s.items.reduce((n, it) => n + it.qty, 0);
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

  private startOfWeek(d: Date): Date {
    const copy = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    copy.setDate(copy.getDate() - ((copy.getDay() + 6) % 7));   // lunes
    return copy;
  }

  private formatWhen(d: Date): string {
    const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    return this.dayKey(d) === this.dayKey(new Date())
      ? time
      : `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}, ${time}`;
  }

  // ═════════ Interacciones ═════════
  protected setTopMode(mode: TopMode): void {
    this.topMode.set(mode);
    this.updateBars();
  }

  protected toggleTrendMenu(event: Event): void {
    event.stopPropagation();
    this.trendMenu.update(v => !v);
  }

  @HostListener('document:click')
  @HostListener('document:keydown.escape')
  protected closeMenus(): void {
    if (this.trendMenu()) this.trendMenu.set(false);
  }

  protected toggleTable(): void {
    this.showTable.update(v => !v);
    this.trendMenu.set(false);
  }

  /** Descarga el gráfico de tendencia como PNG con fondo sólido. */
  protected downloadTrendPng(): void {
    const chart = this.chartLinea;
    if (!chart) return;
    const src = chart.canvas;
    const tmp = document.createElement('canvas');
    tmp.width = src.width;
    tmp.height = src.height;
    const ctx = tmp.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = this.palette().surface;
    ctx.fillRect(0, 0, tmp.width, tmp.height);
    ctx.drawImage(src, 0, 0);
    this.download(tmp.toDataURL('image/png'), `sales-trend-${this.dayKey(new Date())}.png`);
    this.trendMenu.set(false);
    this.showToast('Chart image downloaded.');
  }

  // ═════════ Modal de exportación ═════════
  protected openExport(): void {
    this.exportFormat.set('txt');
    const dlg = this.exportRef.nativeElement;
    if (!dlg.open) dlg.showModal();
  }

  protected closeExport(): void {
    const dlg = this.exportRef.nativeElement;
    if (dlg.open) dlg.close();
  }

  protected onBackdropClick(e: MouseEvent): void {
    if (e.target === this.exportRef.nativeElement) this.closeExport();
  }

  protected selectFormat(format: ExportFormat): void {
    if (this.formats.find(f => f.id === format)?.available) this.exportFormat.set(format);
  }

  protected exportReport(): void {
    if (this.exportFormat() !== 'txt') return;   // el resto de formatos aún no está habilitado

    const filename = `sales-report-${this.dayKey(new Date())}.txt`;
    this.downloadBlob(this.buildTxtReport(), filename, 'text/plain;charset=utf-8');
    this.closeExport();
    this.showToast(`Report downloaded: ${filename}`);
  }

  // ═════════ Reporte TXT ═════════
  private buildTxtReport(): string {
    const w = this.weekSummary();
    const hr = '='.repeat(66);
    const sub = '-'.repeat(66);
    const L = (s: string, n: number) => s.padEnd(n);
    const R = (s: string, n: number) => s.padStart(n);
    const cell = (n: number | null) => (n === null ? '-' : this.money(n));
    const stamp = new Date().toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
    const today = this.fecha.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    const out: string[] = [];

    out.push(hr, ' MARKETPLUS - SALES REPORT', hr);
    out.push(`Generated : ${stamp}`);
    out.push(`Period    : Today (${today}), current week and last 30 days`);
    out.push('Note      : refunded sales are excluded from revenue', '');

    out.push("1. TODAY'S METRICS", sub);
    for (const m of this.metrics()) {
      const delta = m.delta === null ? '' : `${this.pct(m.delta)} ${m.deltaLabel}`;
      out.push(`${L(m.label, 20)}${R(m.value, 12)}   ${L(delta, 22)}${m.hint}`);
    }
    out.push('');

    out.push('2. WEEKLY SALES TREND (this week vs last week)', sub);
    out.push(`${L('Day', 8)}${R('This week', 14)}${R('Last week', 14)}${R('Change', 10)}`);
    for (const r of w.rows) {
      out.push(`${L(r.day, 8)}${R(cell(r.current), 14)}${R(this.money(r.previous), 14)}${R(r.change === null ? '-' : this.pct(r.change), 10)}`);
    }
    out.push(sub);
    out.push(`${L('Total', 8)}${R(this.money(w.total), 14)}${R(this.money(w.lastTotal), 14)}${R(w.change === null ? '-' : this.pct(w.change), 10)}`);
    out.push(`Daily average: ${this.money(w.average)}   Best day: ${w.bestDay} (${this.money(w.bestValue)})`);
    out.push('Change compares the same days of the previous week.', '');

    const rankedBy = this.topMode() === 'volume' ? 'volume' : 'revenue';
    out.push(`3. TOP SELLING PRODUCTS - LAST 30 DAYS (ranked by ${rankedBy})`, sub);
    out.push(`${L('#', 4)}${L('Product', 20)}${R('Units', 8)}${R('Revenue', 14)}`);
    const top = this.topSorted();
    if (!top.length) out.push('No sales in this period.');
    top.forEach((t, i) => {
      out.push(`${L(String(i + 1), 4)}${L(t.name, 20)}${R(String(t.units), 8)}${R(this.money(t.revenue), 14)}`);
    });
    if (top.length) {
      const totals = this.topTotals();
      out.push(sub);
      out.push(`${L('', 4)}${L('Top total', 20)}${R(String(totals.units), 8)}${R(this.money(totals.revenue), 14)}`);
    }
    out.push('');

    out.push('4. RECENT ACTIVITY', sub);
    out.push(`${L('ID', 12)}${L('When', 16)}${L('Method', 8)}${R('Items', 6)}${R('Amount', 12)}  Status`);
    const recent = this.recent();
    if (!recent.length) out.push('No sales yet.');
    for (const t of recent) {
      out.push(`${L(t.id, 12)}${L(t.when, 16)}${L(t.method, 8)}${R(String(t.items), 6)}${R(this.money(t.amount), 12)}  ${t.status.toUpperCase()}`);
    }
    out.push(`Summary: ${this.recentSummary()}`, '');

    out.push(hr, ' End of report', hr, '');
    return out.join('\r\n');
  }

  // ═════════ Gráficos ═════════
  private css(name: string, fallback: string): string {
    const el = document.querySelector('app-dashboard-component') ?? document.documentElement;
    return getComputedStyle(el).getPropertyValue(name).trim() || fallback;
  }

  private palette(): ChartPalette {
    return {
      primary: this.css('--s-primary', '#0F766E'),
      text: this.css('--s-text', '#13202B'),
      muted: this.css('--s-muted', '#55646F'),
      border: this.css('--s-border', '#D3DBE3'),
      surface: this.css('--s-surface', '#FFFFFF'),
      bg: this.css('--s-bg', '#EEF2F6'),
    };
  }

  private alpha(color: string, a: number): string {
    const hex = color.replace('#', '');
    const full = hex.length === 3 ? hex.split('').map(c => c + c).join('') : hex;
    const n = parseInt(full, 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
  }

  private createCharts(): void {
    const p = this.palette();
    this.chartLinea = this.buildLine(p);
    this.chartBarras = this.buildBars(p);
  }

  private destroyCharts(): void {
    this.chartLinea?.destroy();
    this.chartBarras?.destroy();
    this.chartLinea = undefined;
    this.chartBarras = undefined;
  }

  private tooltipStyle(p: ChartPalette) {
    return {
      backgroundColor: p.text,
      titleColor: p.bg,
      bodyColor: p.bg,
      padding: 12,
      cornerRadius: 8,
      boxPadding: 4,
    };
  }

  private buildLine(p: ChartPalette): Chart {
    const w = this.weekSummary();
    return new Chart(this.miGrafica.nativeElement, {
      type: 'line',
      data: {
        labels: this.days,
        datasets: [
          {
            label: 'This week',
            data: w.current,
            borderColor: p.primary,
            backgroundColor: this.alpha(p.primary, 0.14),
            fill: true,
            tension: 0.35,
            borderWidth: 2.5,
            pointRadius: 3,
            pointBackgroundColor: p.primary,
            pointBorderColor: p.surface,
            pointBorderWidth: 2,
            pointHoverRadius: 6,
          },
          {
            label: 'Last week',
            data: w.previous,
            borderColor: p.muted,
            borderDash: [6, 4],
            fill: false,
            tension: 0.35,
            borderWidth: 2,
            pointRadius: 0,
            pointHoverRadius: 4,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: {
            display: true,
            position: 'top',
            align: 'end',
            labels: { color: p.muted, usePointStyle: true, boxWidth: 8, boxHeight: 8, font: { size: 12 } },
          },
          tooltip: {
            ...this.tooltipStyle(p),
            callbacks: {
              title: (items) => `${items[0].label} sales`,
              label: (ctx) => ` ${ctx.dataset.label}: ${this.money(Number(ctx.parsed.y))}`,
              afterBody: (items) => {
                const r = this.weekSummary().rows[items[0].dataIndex];
                return r.current === null ? '' : `Change vs last week: ${this.pct(r.change)}`;
              },
            },
          },
        },
        scales: {
          y: {
            beginAtZero: true,
            border: { display: false },
            grid: { color: this.alpha(p.border, 0.9), drawTicks: false },
            title: { display: true, text: 'Revenue (USD)', color: p.muted, font: { size: 11 } },
            ticks: {
              color: p.muted,
              font: { size: 11 },
              padding: 8,
              callback: (value) => {
                const v = Number(value);
                return v === 0 ? '$0' : v >= 1000 ? `$${v / 1000}k` : `$${v}`;
              },
            },
          },
          x: {
            border: { display: false },
            grid: { display: false },
            ticks: { color: p.muted, font: { size: 11 } },
          },
        },
      },
    });
  }

  private buildBars(p: ChartPalette): Chart {
    const sorted = this.topSorted();
    const mode = this.topMode();
    const shades = [1, 0.82, 0.66, 0.5, 0.36];

    // Escribe el valor al final de cada barra (units o $)
    const valueLabels: Plugin<'bar'> = {
      id: 'valueLabels',
      afterDatasetsDraw: (chart) => {
        const { ctx } = chart;
        const items = this.topSorted();
        const current = this.topMode();
        ctx.save();
        ctx.font = '600 12px Inter, sans-serif';
        ctx.fillStyle = p.text;
        ctx.textBaseline = 'middle';
        chart.getDatasetMeta(0).data.forEach((bar, i) => {
          const item = items[i];
          if (!item) return;
          const label = current === 'volume' ? `${item.units} units` : this.money(item.revenue);
          ctx.fillText(label, bar.x + 8, bar.y);
        });
        ctx.restore();
      },
    };

    return new Chart(this.miGraficaBarras.nativeElement, {
      type: 'bar',
      data: {
        labels: sorted.map(t => t.name),
        datasets: [{
          data: sorted.map(t => (mode === 'volume' ? t.units : t.revenue)),
          backgroundColor: shades.map(s => this.alpha(p.primary, s)),
          hoverBackgroundColor: p.primary,
          borderRadius: 4,
          borderSkipped: false,
          barThickness: 22,
        }],
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        layout: { padding: { right: 84 } },
        plugins: {
          legend: { display: false },
          tooltip: {
            ...this.tooltipStyle(p),
            displayColors: false,
            callbacks: {
              title: (items) => `#${items[0].dataIndex + 1} ${items[0].label}`,
              label: (ctx) => {
                const item = this.topSorted()[ctx.dataIndex];
                const t = this.topTotals();
                const share = this.topMode() === 'volume'
                  ? (item.units / t.units) * 100
                  : (item.revenue / t.revenue) * 100;
                return [
                  `Units sold: ${item.units}`,
                  `Revenue: ${this.money(item.revenue)}`,
                  `Share of top 5: ${share.toFixed(1)}%`,
                ];
              },
            },
          },
        },
        scales: {
          x: { display: false, beginAtZero: true, grid: { display: false } },
          y: {
            border: { display: false },
            grid: { display: false },
            ticks: { color: p.text, font: { size: 12, weight: 600 } },
          },
        },
      },
      plugins: [valueLabels],
    });
  }

  private updateBars(): void {
    const chart = this.chartBarras;
    if (!chart) return;
    const sorted = this.topSorted();
    const mode = this.topMode();
    chart.data.labels = sorted.map(t => t.name);
    chart.data.datasets[0].data = sorted.map(t => (mode === 'volume' ? t.units : t.revenue));
    chart.update();
  }

  // ═════════ Utilidades ═════════
  private download(href: string, filename: string): void {
    const a = document.createElement('a');
    a.href = href;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  private downloadBlob(content: string, filename: string, mime: string): void {
    const url = URL.createObjectURL(new Blob([content], { type: mime }));
    this.download(url, filename);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  private showToast(text: string): void {
    clearTimeout(this.toastTimer);
    this.toast.set(text);
    this.toastTimer = setTimeout(() => this.toast.set(null), 3500);
  }
}

