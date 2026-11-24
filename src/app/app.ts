import { NgClass } from '@angular/common';
import { Component, ElementRef, ViewChild, inject } from '@angular/core';
import { Router, RouterModule, RouterOutlet } from '@angular/router';
import { SettingsService } from './settings-service';
import type { AppSettings, ThemeMode } from './settings-service';


@Component({
  selector: 'app-root',
  imports: [RouterOutlet, NgClass, RouterModule],
  templateUrl: './app.html',
  styleUrl: './app.css'
})
export class App {
  @ViewChild('settingsModal') private modalRef!: ElementRef<HTMLDialogElement>;

  private readonly router = inject(Router);
  protected readonly settingsService = inject(SettingsService);

  protected readonly themes: { value: ThemeMode; label: string; icon: string }[] = [
    { value: 'light',  label: 'Light',  icon: 'light_mode' },
    { value: 'dark',   label: 'Dark',   icon: 'dark_mode' },
    { value: 'system', label: 'System', icon: 'computer' },
  ];

  protected get cfg(): AppSettings {
    return this.settingsService.settings();
  }

  getCurrentUrl(): string {
    return this.router.url;
  }

  isActive(nav: string): boolean {
    return this.router.url.includes(nav);
  }

  // ───────── Settings modal ─────────
  openSettings(): void {
    const dlg = this.modalRef.nativeElement;
    if (!dlg.open) dlg.showModal();
  }

  closeSettings(): void {
    const dlg = this.modalRef.nativeElement;
    if (dlg.open) dlg.close();
  }

  onBackdropClick(e: MouseEvent): void {
    if (e.target === this.modalRef.nativeElement) this.closeSettings();
  }

  setTheme(theme: ThemeMode): void {
    this.settingsService.update({ theme });
  }

  setTaxRate(input: HTMLInputElement): void {
    const n = parseFloat(input.value);
    const value = Number.isNaN(n) ? this.cfg.taxRate : Math.min(Math.max(n, 0), 30);
    this.settingsService.update({ taxRate: value });
    input.value = String(value);   // refleja el valor ya limitado a 0–30
  }

  toggleMotion(): void {
    this.settingsService.update({ reduceMotion: !this.cfg.reduceMotion });
  }

  resetSettings(): void {
    this.settingsService.reset();
  }
}