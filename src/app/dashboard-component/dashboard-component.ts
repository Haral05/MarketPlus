import { DatePipe } from '@angular/common';
import {
  AfterViewInit, Component, ElementRef, HostListener, OnDestroy, ViewChild, computed, signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { Chart, Plugin, registerables } from 'chart.js';

Chart.register(...registerables);

type TopMode = 'volume' | 'revenue';
type ExportFormat = 'txt' | 'csv' | 'xlsx' | 'pdf';

interface Metric {
  label: string;
  icon: string;
  value: string;
  delta: number | null;   // % frente al periodo anterior
  deltaLabel: string;
  hint: string;
}

interface Transaction {
  id: string;
  time: string;
  method: 'Card' | 'Cash';
  items: number;
  amount: number;
  status: 'paid' | 'void';
}

interface TopProduct {
  name: string;
  units: number;
  revenue: number;
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

  private chartLinea?: Chart;
  private chartBarras?: Chart;
  private themeObserver?: MutationObserver;
  private toastTimer?: ReturnType<typeof setTimeout>;

  // ═════════ Datos de ejemplo (sustituir por un servicio de ventas) ═════════
  private readonly days: string[] = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  private readonly thisWeek: number[] = [2500, 4000, 1800, 9000, 7500, 12000, 10500];
  private readonly lastWeek: number[] = [2100, 3600, 2300, 7800, 7900, 10400, 9800];

  private readonly topProducts: TopProduct[] = [
    { name: 'Azucar',   units: 95, revenue: 1425.0 },
    { name: 'Arroz',    units: 72, revenue: 1080.0 },
    { name: 'Aceite',   units: 55, revenue: 1650.0 },
    { name: 'Leche',    units: 40, revenue: 1000.0 },
    { name: 'Boniato',  units: 22, revenue: 35.2 },
  ];

  protected readonly recent: Transaction[] = [
    { id: '#TRX-8907', time: '10:43 AM', method: 'Card', items: 3, amount: 142.5, status: 'paid' },
    { id: '#TRX-8906', time: '10:31 AM', method: 'Cash', items: 1, amount: 12.8,  status: 'paid' },
    { id: '#TRX-8905', time: '10:18 AM', method: 'Card', items: 6, amount: 96.4,  status: 'void' },
    { id: '#TRX-8904', time: '10:02 AM', method: 'Cash', items: 2, amount: 34.0,  status: 'paid' },
    { id: '#TRX-8903', time: '09:47 AM', method: 'Card', items: 4, amount: 78.25, status: 'paid' },
    { id: '#TRX-8902', time: '09:30 AM', method: 'Cash', items: 5, amount: 61.9,  status: 'paid' },
  ];

  protected readonly metrics: Metric[] = this.buildMetrics();
  protected readonly weekSummary = this.buildWeekSummary();

  protected readonly recentSummary = (() => {
    const paid = this.recent.filter(t => t.status === 'paid');
    const voids = this.recent.length - paid.length;
    const total = paid.reduce((s, t) => s + t.amount, 0);
    return `${this.recent.length} transactions · ${voids} void · ${this.money(total)} paid`;
  })();

  // ═════════ Estado (signals) ═════════
  protected readonly topMode = signal<TopMode>('volume');
  protected readonly showTable = signal(false);
  protected readonly trendMenu = signal(false);
  protected readonly exportFormat = signal<ExportFormat>('txt');
  protected readonly toast = signal<string | null>(null);

  protected readonly topSorted = computed<TopProduct[]>(() => {
    const key = this.topMode() === 'volume' ? 'units' : 'revenue';
    return [...this.topProducts].sort((a, b) => b[key] - a[key]);
  });

  protected readonly topTotals = computed(() => {
    const list = this.topProducts;
    return {
      units: list.reduce((s, t) => s + t.units, 0),
      revenue: list.reduce((s, t) => s + t.revenue, 0),
    };
  });

  protected readonly formats: { id: ExportFormat; label: string; description: string; icon: string; available: boolean }[] = [
    { id: 'txt',  label: 'Plain text (.txt)', description: 'Readable report with every section', icon: 'description',    available: true },
    { id: 'csv',  label: 'CSV (.csv)',        description: 'For spreadsheets and data tools',    icon: 'table',          available: false },
    { id: 'xlsx', label: 'Excel (.xlsx)',     description: 'Formatted workbook with tabs',       icon: 'grid_on',        available: false },
    { id: 'pdf',  label: 'PDF (.pdf)',        description: 'Print-ready document with charts',   icon: 'picture_as_pdf', available: false },
  ];

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

  // ═════════ Datos derivados ═════════
  private buildMetrics(): Metric[] {
    const sales = 14055.25;
    const transactions = 453;
    const cash = 213;
    const profit = 4057.0;
    return [
      { label: 'Total sales today', icon: 'attach_money', value: this.money(sales),
        delta: 12.4, deltaLabel: 'vs yesterday', hint: `Avg. ticket ${this.money(sales / transactions)}` },
      { label: 'Transactions', icon: 'swap_horiz', value: String(transactions),
        delta: 5.1, deltaLabel: 'vs yesterday', hint: 'Orders processed today' },
      { label: 'Cash payments', icon: 'payments', value: String(cash),
        delta: -2.3, deltaLabel: 'vs yesterday', hint: `${Math.round((cash / transactions) * 100)}% of transactions` },
      { label: 'Gross profit', icon: 'trending_up', value: this.money(profit),
        delta: 8.7, deltaLabel: 'vs yesterday', hint: `Margin ${((profit / sales) * 100).toFixed(1)}%` },
    ];
  }

  private buildWeekSummary() {
    const sum = (a: number[]) => a.reduce((s, n) => s + n, 0);
    const total = sum(this.thisWeek);
    const lastTotal = sum(this.lastWeek);
    const bestIdx = this.thisWeek.indexOf(Math.max(...this.thisWeek));
    return {
      total,
      lastTotal,
      average: total / this.thisWeek.length,
      bestDay: this.days[bestIdx],
      bestValue: this.thisWeek[bestIdx],
      change: ((total - lastTotal) / lastTotal) * 100,
      rows: this.days.map((day, i) => ({
        day,
        current: this.thisWeek[i],
        previous: this.lastWeek[i],
        change: ((this.thisWeek[i] - this.lastWeek[i]) / this.lastWeek[i]) * 100,
      })),
    };
  }

  // ═════════ Formato ═════════
  protected money(n: number): string {
    return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  protected pct(n: number): string {
    return `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`;
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
    this.download(tmp.toDataURL('image/png'), `sales-trend-${this.isoDate()}.png`);
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
    const format = this.exportFormat();
    if (format !== 'txt') return;   // el resto de formatos aún no está habilitado

    const filename = `sales-report-${this.isoDate()}.txt`;
    this.downloadBlob(this.buildTxtReport(), filename, 'text/plain;charset=utf-8');
    this.closeExport();
    this.showToast(`Report downloaded: ${filename}`);
  }

  // ═════════ Reporte TXT ═════════
  private buildTxtReport(): string {
    const w = this.weekSummary;
    const hr = '='.repeat(66);
    const sub = '-'.repeat(66);
    const L = (s: string, n: number) => s.padEnd(n);
    const R = (s: string, n: number) => s.padStart(n);
    const stamp = new Date().toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
    const today = this.fecha.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    const out: string[] = [];

    out.push(hr, ' MARKETPLUS - SALES REPORT', hr);
    out.push(`Generated : ${stamp}`);
    out.push(`Period    : Today (${today}) and the last 7 days`, '');

    out.push("1. TODAY'S METRICS", sub);
    for (const m of this.metrics) {
      const delta = m.delta === null ? '' : `${this.pct(m.delta)} ${m.deltaLabel}`;
      out.push(`${L(m.label, 20)}${R(m.value, 12)}   ${L(delta, 22)}${m.hint}`);
    }
    out.push('');

    out.push('2. WEEKLY SALES TREND (this week vs last week)', sub);
    out.push(`${L('Day', 8)}${R('This week', 14)}${R('Last week', 14)}${R('Change', 10)}`);
    for (const r of w.rows) {
      out.push(`${L(r.day, 8)}${R(this.money(r.current), 14)}${R(this.money(r.previous), 14)}${R(this.pct(r.change), 10)}`);
    }
    out.push(sub);
    out.push(`${L('Total', 8)}${R(this.money(w.total), 14)}${R(this.money(w.lastTotal), 14)}${R(this.pct(w.change), 10)}`);
    out.push(`Daily average: ${this.money(w.average)}   Best day: ${w.bestDay} (${this.money(w.bestValue)})`, '');

    const rankedBy = this.topMode() === 'volume' ? 'volume' : 'revenue';
    out.push(`3. TOP SELLING PRODUCTS (ranked by ${rankedBy})`, sub);
    out.push(`${L('#', 4)}${L('Product', 20)}${R('Units', 8)}${R('Revenue', 14)}`);
    this.topSorted().forEach((t, i) => {
      out.push(`${L(String(i + 1), 4)}${L(t.name, 20)}${R(String(t.units), 8)}${R(this.money(t.revenue), 14)}`);
    });
    const totals = this.topTotals();
    out.push(sub);
    out.push(`${L('', 4)}${L('Top 5 total', 20)}${R(String(totals.units), 8)}${R(this.money(totals.revenue), 14)}`, '');

    out.push('4. RECENT ACTIVITY', sub);
    out.push(`${L('ID', 12)}${L('Time', 11)}${L('Method', 8)}${R('Items', 6)}${R('Amount', 12)}  Status`);
    for (const t of this.recent) {
      out.push(`${L(t.id, 12)}${L(t.time, 11)}${L(t.method, 8)}${R(String(t.items), 6)}${R(this.money(t.amount), 12)}  ${t.status.toUpperCase()}`);
    }
    out.push(`Summary: ${this.recentSummary}`, '');

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
    const w = this.weekSummary;
    return new Chart(this.miGrafica.nativeElement, {
      type: 'line',
      data: {
        labels: this.days,
        datasets: [
          {
            label: 'This week',
            data: this.thisWeek,
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
            data: this.lastWeek,
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
                const r = w.rows[items[0].dataIndex];
                return `Change vs last week: ${this.pct(r.change)}`;
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
  private isoDate(): string {
    return new Date().toLocaleDateString('en-CA');   // yyyy-mm-dd
  }

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

