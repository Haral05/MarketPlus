import { DatePipe, DecimalPipe } from '@angular/common';
import { Component, computed, ElementRef, HostListener, inject, signal, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { GetProductService } from '../get-product-service';
import { Product } from '../interfaces/product.interface';
import { SettingsService } from '../settings-service';
import { SalesHistoryService } from '../sales-history-service';
import { ReceiptService } from '../receipt-service';


  

type ModalType = 'info' | 'confirmVoid' | 'discount' | 'pay' | 'success';
type ModalTone = 'error' | 'warning';
type PayMethod = 'cash' | 'card';
type DiscountMode = 'percent' | 'amount';

interface SaleReceipt {
  number: string;
  method: PayMethod;
  total: number;
  change: number;
  items: number;
  date: Date;
}

@Component({
  imports: [DatePipe, DecimalPipe, FormsModule],
  selector: 'app-sales-component',
  styleUrl: './sales-component.css',
  templateUrl: './sales-component.html',
})
export class SalesComponent {
  @ViewChild('modal') private modalRef!: ElementRef<HTMLDialogElement>;
  @ViewChild('barcodeInput') private barcodeRef!: ElementRef<HTMLInputElement>;

  private receipts = inject(ReceiptService);
  
  // Scan bar focus F1
  @HostListener('window:keydown', ['$event'])
  handleKeydown(event: KeyboardEvent) {
    if (event.key === 'F1') {
      event.preventDefault();
      this.barcodeRef.nativeElement.focus();
    }
  }

  private history = inject(SalesHistoryService);
 
  protected readonly quickCash = [20, 50, 100];

  protected fechaActual: Date = new Date();
  protected productSelected?: Product;

  // Discount applied to the sale
  protected discountMode: DiscountMode = 'percent';
  protected discountValue = 0;
  // Discount modal draft (applied only on "Apply")
  protected draftMode: DiscountMode = 'percent';
  protected draftValue: number | null = null;

  // Modal state
  protected modalType: ModalType | null = null;
  protected modalTone: ModalTone = 'warning';
  protected modalTitle = '';
  protected modalMessage = '';

  // Payment
  protected payMethod: PayMethod = 'cash';
  protected cashReceived: number | null = null;
  protected receipt?: SaleReceipt;
  private saleCounter = 1;
  readonly TaxNumb = signal<Number>(0);

  constructor(private productService: GetProductService, private settingsServ: SettingsService) {   
    this.TaxNumb = settingsServ.TaxNumber;
  }

  protected readonly TAX_RATE = computed(() => {
    return Number(this.TaxNumb()) / 100;
  });
  // ───────── Computed totals (single source of truth) ─────────
  private round2(n: number): number {
    return Math.round((n + Number.EPSILON) * 100) / 100;
  }

  get subtotal(): number {
    return this.round2(this.getCarry().reduce((s, p) => s + p.price * p.inCarry, 0));
  }

  get discount(): number {
    const v = this.discountValue;
    if (!v || v <= 0) return 0;
    const raw = this.discountMode === 'percent' ? (this.subtotal * Math.min(v, 100)) / 100 : v;
    return this.round2(Math.min(raw, this.subtotal));
  }

  get tax(): number {
    return this.round2((this.subtotal - this.discount) * this.TAX_RATE());
  }

  get totalp(): number {
    return this.round2(this.subtotal - this.discount + this.tax);
  }

  get change(): number {
    return this.round2((this.cashReceived ?? 0) - this.totalp);
  }

  get canConfirmPay(): boolean {
    return this.payMethod === 'card' || (this.cashReceived ?? 0) >= this.totalp;
  }

  // ───────── Carrito ─────────
  getCarry(): Product[] {
    return this.productService.carryProducts;
  }

  getAllProducts(): Product[] {
    return this.productService.getProducts();
  }

  available(p: Product): number {
    return p.total - p.inCarry;
  }

  stockLevel(p: Product): 'high' | 'mid' | 'low' | 'none' {
    const n = this.available(p);
    if (n >= 15) return 'high';
    if (n >= 8) return 'mid';
    if (n === 0) return 'none';
    return 'low';
  }

  getProductSelected(product: Product): void {
    this.productSelected = product;
    const inCart = this.getCarry().find(p => p.id === product.id);

    if (inCart) {
      this.addCarry(inCart);
    } else if (product.total > 0) {
      product.inCarry++;
      this.getCarry().push(product);
    } else {
      this.showStockModal(product);
    }
  }

  getProduct(event: Event): void {
    const input = event.target as HTMLInputElement;
    const id = parseInt(input.value, 10);
    const product = Number.isNaN(id) ? undefined : this.productService.getProductById(id);
    input.value = '';

    if (product) this.getProductSelected(product);
    else this.showInfo('Product not found', `There is no product with the code "${id || '—'}".`, 'error');
  }

  getProductByName(name: string): void {
    const product = name.trim() ? this.productService.getProductByName(name.trim()) : undefined;
    if (product) this.getProductSelected(product);
    else this.showInfo('Product not found', `No results for "${name}".`, 'error');
  }

  addCarry(product: Product): void {
    if (product.inCarry < product.total) product.inCarry++;
    else this.showStockModal(product);
  }

  lessCarry(product: Product): void {
    product.inCarry--;
    if (product.inCarry <= 0) {
      product.inCarry = 0;
      const i = this.getCarry().findIndex(p => p.id === product.id);
      if (i !== -1) this.getCarry().splice(i, 1);
    }
  }

  carryEmpty(): void {
    this.getCarry().forEach(p => (p.inCarry = 0));
    this.productService.carryProducts = [];
    this.discountValue = 0;
  }

  // ───────── Atajos / scanner ─────────
  @HostListener('document:keydown.f1', ['$event'])
  focusBarcode(event?: Event): void {
    event?.preventDefault();
    this.barcodeRef?.nativeElement.focus();
  }

  // ───────── Modal engine (<dialog> nativo) ─────────
  private open(type: ModalType): void {
    this.modalType = type;
    const dlg = this.modalRef.nativeElement;
    if (!dlg.open) dlg.showModal();
  }

  closeModal(): void {
    const dlg = this.modalRef.nativeElement;
    if (dlg.open) dlg.close();
  }

  onModalClosed(): void {
    this.modalType = null;
    this.focusBarcode();
  }

  onBackdropClick(e: MouseEvent): void {
    if (e.target === this.modalRef.nativeElement && this.modalType !== 'success') this.closeModal();
  }

  private showInfo(title: string, message: string, tone: ModalTone = 'warning'): void {
    this.modalTitle = title;
    this.modalMessage = message;
    this.modalTone = tone;
    this.open('info');
  }

  private showStockModal(p: Product): void {
    this.showInfo(
      'Out of stock',
      p.total === 0
        ? `"${p.name}" has no units available.`
        : `Only ${p.total} unit(s) of "${p.name}" available. You already have all of them in the cart.`,
      'warning'
    );
  }

  // ───────── Void ─────────
  requestVoid(): void {
    if (!this.getCarry().length) {
      this.showInfo('Nothing to void', 'The cart is already empty.');
      return;
    }
    this.open('confirmVoid');
  }

  confirmVoid(): void {
    this.carryEmpty();
    this.closeModal();
  }

  // ───────── Discount ─────────
  openDiscount(): void {
    if (!this.getCarry().length) {
      this.showInfo('Add products first', 'You need at least one product in the cart to apply a discount.');
      return;
    }
    this.draftMode = this.discountMode;
    this.draftValue = this.discountValue || null;
    this.open('discount');
  }

  get draftInvalid(): boolean {
    const v = this.draftValue;
    if (v == null || v <= 0) return true;
    return this.draftMode === 'percent' ? v > 100 : v > this.subtotal;
  }

  applyDiscount(): void {
    if (this.draftInvalid) return;
    this.discountMode = this.draftMode;
    this.discountValue = this.draftValue!;
    this.closeModal();
  }

  removeDiscount(): void {
    this.discountValue = 0;
    this.closeModal();
  }

  // ───────── Pay ─────────
  openPay(): void {
    if (!this.getCarry().length) {
      this.showInfo('Cart is empty', 'Add at least one product before charging.');
      return;
    }
    this.payMethod = 'cash';
    this.cashReceived = null;
    this.open('pay');
  }

  setCash(amount: number | 'exact'): void {
    this.cashReceived = amount === 'exact' ? this.totalp : amount;
  }

  confirmPay(): void {
    if (!this.canConfirmPay) return;
  
    const items = this.getCarry().reduce((s, p) => s + p.inCarry, 0);
  
    // Se registra antes de vaciar el carrito
    const sale = this.history.record({
      items: this.getCarry().map(p => ({ id: p.id, name: p.name, price: p.price, qty: p.inCarry })),
      subtotal: this.subtotal,
      discount: this.discount,
      taxRate: this.TAX_RATE(),
      tax: this.tax,
      total: this.totalp,
      method: this.payMethod,
      cashReceived: this.payMethod === 'cash' ? this.cashReceived : null,
    });
  
    this.receipt = {
      number: String(sale.number).padStart(5, '0'),
      method: this.payMethod,
      total: this.totalp,
      change: this.payMethod === 'cash' ? Math.max(this.change, 0) : 0,
      items,
      date: sale.date,
    };
  
    this.getCarry().forEach(p => (p.total -= p.inCarry));
    this.carryEmpty();
    this.productSelected = undefined;
    this.open('success');
    if (this.settingsServ.settings().printReceipt) this.receipts.print(sale);
  }
}