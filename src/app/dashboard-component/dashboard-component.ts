import { DatePipe } from '@angular/common';
import { Component } from '@angular/core';
import {
  AfterViewInit,
  OnDestroy,
  ElementRef,
  ViewChild,
  ChangeDetectorRef
} from '@angular/core';
import { Pipe } from '@angular/core';
import { Chart, ChartData, ChartOptions, registerables } from 'chart.js';
import { RouterLink } from "@angular/router";

Chart.register(...registerables);


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

  private chartLinea?: Chart;
  private chartBarras?: Chart;
  private observer?: ResizeObserver;

  constructor(private cdr: ChangeDetectorRef) {}

  ngAfterViewInit(): void {
    this.cdr.detectChanges();

    requestAnimationFrame(() => {
      const contenedorLinea = this.miGrafica.nativeElement.parentElement!;
      const contenedorBarras = this.miGraficaBarras.nativeElement.parentElement!;

      // Si ya tienen tamaño, dibuja de una
      if (contenedorLinea.clientHeight > 0 && contenedorBarras.clientHeight > 0) {
        this.crearGraficaLinea();
        this.crearGraficaBarras();
      }

      // Si aún no, espera a que tengan tamaño
      this.observer = new ResizeObserver(() => {
        if (!this.chartLinea && contenedorLinea.clientHeight > 0) {
          this.crearGraficaLinea();
        }
        if (!this.chartBarras && contenedorBarras.clientHeight > 0) {
          this.crearGraficaBarras();
        }
      });
      this.observer.observe(contenedorLinea);
      this.observer.observe(contenedorBarras);
    });
  }

  ngOnDestroy(): void {
    this.chartLinea?.destroy();
    this.chartBarras?.destroy();
    this.observer?.disconnect();
  }


  private crearGraficaLinea(): void {
    this.chartLinea = new Chart(this.miGrafica.nativeElement, {
      type: 'line',
      data: {
        labels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
        datasets: [{
          label: 'Sales',
          data: [2500, 4000, 1800, 9000, 7500, 12000, 10500],
          borderColor: '#3b82f6',
          backgroundColor: 'rgba(59, 130, 246, 0.15)',
          fill: true,
          tension: 0.35,
          pointRadius: 0,
          pointHoverRadius: 5,
          borderWidth: 2
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#111827',
            padding: 10,
            cornerRadius: 8,
            displayColors: false,
            callbacks: {
              label: (ctx) => `$${Number(ctx.parsed.y).toLocaleString()}`
            }
          }
        },
        scales: {
          y: {
            beginAtZero: true,
            border: { display: false },
            grid: { color: '#e5e7eb', drawTicks: false },
            ticks: {
              color: '#9ca3af',
              font: { size: 11 },
              callback: (value) => {
                const v = Number(value);
                return v === 0 ? '$0' : `$${v / 1000}k`;
              }
            }
          },
          x: {
            border: { display: false },
            grid: { display: false },
            ticks: { color: '#9ca3af', font: { size: 11 } }
          }
        }
      }
    });
  }


  private crearGraficaBarras(): void {
    this.chartBarras = new Chart(this.miGraficaBarras.nativeElement, {
      type: 'bar',
      data: {
        labels: ['SKU-A', 'SKU-B', 'SKU-C', 'SKU-D', 'SKU-E'],
        datasets: [{
          data: [95, 72, 55, 40, 22],
          backgroundColor: [
            '#3b82f6', // azul fuerte
            '#60a5fa', // azul medio
            '#93c5fd',
            '#bfdbfe',
            '#dbeafe'  // azul claro
          ],
          hoverBackgroundColor: [
            '#2563eb',
            '#3b82f6',
            '#60a5fa',
            '#93c5fd',
            '#bfdbfe'
          ],
          borderRadius: 4,
          borderSkipped: false,
          barThickness: 32
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#111827',
            padding: 10,
            cornerRadius: 8,
            displayColors: false,
            callbacks: {
              label: (ctx) => `${ctx.parsed.y} units`
            }
          }
        },
        scales: {
          y: {
            display: false,
            beginAtZero: true,
            grid: { display: false }
          },
          x: {
            border: { display: false },
            grid: { display: false },
            ticks: { color: '#9ca3af', font: { size: 11 } }
          }
        }
      }
    });
  }

}
