import { DecimalPipe } from '@angular/common';
import {
  Component, ElementRef, HostListener, Injector, ViewChild,
  afterNextRender, computed, inject, signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { GetProductService } from '../get-product-service';
import { Product } from '../interfaces/product.interface';

/** Product + categoría opcional (puedes añadir `category?: string` a tu interfaz y borrar este alias). */
type InventoryProduct = Product & { category?: string };

type StockLevel = 'high' | 'medium' | 'low' | 'out';
type StockFilter = 'all' | StockLevel;
type MenuName = 'category' | 'stock';
type ModalType = 'form' | 'delete';
type FormMode = 'add' | 'edit';

interface ProductDraft {
  id: number | null;
  name: string;
  category: string;
  price: number | null;
  total: number | null;
}

interface DraftErrors {
  id?: string;
  name?: string;
  category?: string;
  price?: string;
  total?: string;
}

const ALL_CATEGORIES = 'All categories';
const UNCATEGORIZED = 'Uncategorized';

@Component({
  imports: [DecimalPipe, FormsModule],
  selector: 'app-inventory-component',
  styleUrl: './inventory-component.css',
  templateUrl: './inventory-component.html',
})
export class InventoryComponent {
  @ViewChild('modal') private modalRef!: ElementRef<HTMLDialogElement>;

  private readonly productsService = inject(GetProductService);
  private readonly injector = inject(Injector);

  protected readonly stockOptions: { value: StockFilter; label: string }[] = [
    { value: 'all', label: 'All' },
    { value: 'high', label: 'High' },
    { value: 'medium', label: 'Medium' },
    { value: 'low', label: 'Low' },
    { value: 'out', label: 'Out' },
  ];

  // ───────── Estado ─────────
  protected readonly products = signal<InventoryProduct[]>(this.source().slice());
  protected readonly pageSize = signal(10);
  protected readonly currentPage = signal(1);

  protected readonly categoryFilter = signal<string>(ALL_CATEGORIES);
  protected readonly stockFilter = signal<StockFilter>('all');
  protected readonly openMenu = signal<MenuName | null>(null);

  // Modal
  protected readonly modalType = signal<ModalType | null>(null);
  protected readonly mode = signal<FormMode>('add');
  protected readonly target = signal<InventoryProduct | null>(null);
  protected draft: ProductDraft = { id: null, name: '', category: '', price: null, total: null };
  protected submitted = false;

  // Toast
  protected readonly toast = signal<string | null>(null);
  private toastTimer?: ReturnType<typeof setTimeout>;

  // ───────── Derivados ─────────
  protected readonly categories = computed<string[]>(() => {
    const set = new Set(this.products().map(p => this.categoryOf(p)));
    return [ALL_CATEGORIES, ...[...set].sort((a, b) => a.localeCompare(b))];
  });

  protected readonly categorySuggestions = computed<string[]>(() =>
    this.categories().slice(1).filter(c => c !== UNCATEGORIZED));

  /** Resultado de aplicar los filtros de categoría y stock. */
  protected readonly filtered = computed<InventoryProduct[]>(() => {
    const cat = this.categoryFilter();
    const stock = this.stockFilter();
    return this.products().filter(p =>
      (cat === ALL_CATEGORIES || this.categoryOf(p) === cat) &&
      (stock === 'all' || this.stockLevel(p) === stock));
  });

  protected readonly hasFilters = computed(() =>
    this.categoryFilter() !== ALL_CATEGORIES || this.stockFilter() !== 'all');

  protected readonly stockFilterLabel = computed(() =>
    this.stockOptions.find(o => o.value === this.stockFilter())?.label ?? 'All');

  protected readonly totalPages = computed(() =>
    Math.max(1, Math.ceil(this.filtered().length / this.pageSize())));

  protected readonly visibleProducts = computed(() => {
    const start = (this.currentPage() - 1) * this.pageSize();
    return this.filtered().slice(start, start + this.pageSize());
  });

  protected readonly range = computed(() => {
    const total = this.filtered().length;
    if (!total) return { from: 0, to: 0, total: 0 };
    const from = (this.currentPage() - 1) * this.pageSize() + 1;
    return { from, to: from + this.visibleProducts().length - 1, total };
  });

  protected readonly visiblePages = computed<number[]>(() => {
    const total = this.totalPages();
    const current = this.currentPage();

    if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
    if (current <= 4) return [1, 2, 3, 4, 5, -1, total];
    if (current >= total - 3) return [1, -1, total - 4, total - 3, total - 2, total - 1, total];
    return [1, -1, current - 1, current, current + 1, -1, total];
  });

  // ───────── Datos (fuente única: el servicio) ─────────
  private source(): InventoryProduct[] {
    return this.productsService.getProducts() as InventoryProduct[];
  }

  /** Vuelve a leer el servicio y deja filtros y página en un estado válido. */
  private refresh(): void {
    this.products.set([...this.source()]);
    if (!this.categories().includes(this.categoryFilter())) {
      this.categoryFilter.set(ALL_CATEGORIES);
    }
    if (this.currentPage() > this.totalPages()) {
      this.currentPage.set(this.totalPages());
    }
  }

  protected categoryOf(p: InventoryProduct): string {
    return p.category?.trim() || UNCATEGORIZED;
  }

  protected stockLevel(p: InventoryProduct): StockLevel {
    if (p.total <= 0) return 'out';
    if (p.total >= 15) return 'high';
    if (p.total >= 8) return 'medium';
    return 'low';
  }

  protected stockLabel(level: StockLevel): string {
    return { high: 'IN STOCK', medium: 'MEDIUM STOCK', low: 'LOW STOCK', out: 'OUT OF STOCK' }[level];
  }

  // ───────── Filtros ─────────
  protected toggleMenu(menu: MenuName, event: Event): void {
    event.stopPropagation();
    this.openMenu.update(m => (m === menu ? null : menu));
  }

  @HostListener('document:click')
  @HostListener('document:keydown.escape')
  protected closeMenus(): void {
    if (this.openMenu()) this.openMenu.set(null);
  }

  protected selectCategory(category: string): void {
    this.categoryFilter.set(category);
    this.currentPage.set(1);
    this.openMenu.set(null);
  }

  protected selectStock(value: StockFilter): void {
    this.stockFilter.set(value);
    this.currentPage.set(1);
    this.openMenu.set(null);
  }

  protected clearFilters(): void {
    this.categoryFilter.set(ALL_CATEGORIES);
    this.stockFilter.set('all');
    this.currentPage.set(1);
  }

  // ───────── Paginación ─────────
  protected goToPage(page: number): void {
    if (page < 1 || page > this.totalPages()) return;
    this.currentPage.set(page);
  }
  protected nextPage(): void { this.goToPage(this.currentPage() + 1); }
  protected prevPage(): void { this.goToPage(this.currentPage() - 1); }

  // ───────── Motor del modal (<dialog> nativo) ─────────
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
    this.submitted = false;
  }

  protected onBackdropClick(e: MouseEvent): void {
    // El formulario no se cierra al hacer clic fuera para no perder lo escrito
    if (e.target === this.modalRef.nativeElement && this.modalType() === 'delete') this.closeModal();
  }

  // ───────── Añadir / Editar ─────────
  private nextId(): number {
    return Math.max(0, ...this.products().map(p => Number(p.id) || 0)) + 1;
  }

  protected openAdd(): void {
    this.mode.set('add');
    this.target.set(null);
    this.draft = { id: this.nextId(), name: '', category: '', price: null, total: null };
    this.submitted = false;
    this.open('form');
  }

  protected openEdit(p: InventoryProduct): void {
    this.mode.set('edit');
    this.target.set(p);
    this.draft = { id: Number(p.id), name: p.name, category: p.category ?? '', price: p.price, total: p.total };
    this.submitted = false;
    this.open('form');
  }

  protected get errors(): DraftErrors {
    const d = this.draft;
    const e: DraftErrors = {};
    const editing = this.mode() === 'edit' ? this.target() : null;
    const all = this.products();

    if (this.mode() === 'add') {
      if (d.id == null || !Number.isInteger(d.id) || d.id <= 0) e.id = 'Enter a whole number greater than 0.';
      else if (all.some(p => Number(p.id) === d.id)) e.id = 'This ID already exists.';
    }

    const name = (d.name ?? '').trim();
    if (!name) e.name = 'Name is required.';
    else if (name.length > 60) e.name = 'Maximum 60 characters.';
    else if (all.some(p => p !== editing && p.name.trim().toLowerCase() === name.toLowerCase())) {
      e.name = 'A product with this name already exists.';
    }

    if ((d.category ?? '').trim().length > 30) e.category = 'Maximum 30 characters.';

    if (d.price == null || !Number.isFinite(d.price) || d.price <= 0) e.price = 'Enter a price greater than 0.';
    else if (d.price > 999999) e.price = 'Price is too high.';
    else if (Math.round(d.price * 100) / 100 !== d.price) e.price = 'Use at most 2 decimals.';

    if (d.total == null || !Number.isInteger(d.total) || d.total < 0) {
      e.total = 'Enter a whole number, 0 or more.';
    } else if (editing && d.total < (editing.inCarry ?? 0)) {
      e.total = `${editing.inCarry} unit(s) are in the current sale cart.`;
    }

    return e;
  }

  protected save(): void {
    this.submitted = true;
    if (Object.keys(this.errors).length) {
      afterNextRender(
        () => this.modalRef.nativeElement.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus(),
        { injector: this.injector },
      );
      return;
    }

    const d = this.draft;
    const name = d.name.trim();
    const category = d.category.trim();

    if (this.mode() === 'add') {
      const product = {
        id: d.id!, name, price: d.price!, total: d.total!, inCarry: 0,
        ...(category ? { category } : {}),
      } as InventoryProduct;

      this.source().push(product);
      this.categoryFilter.set(ALL_CATEGORIES);
      this.stockFilter.set('all');
      this.refresh();

      // Salta a la página donde quedó el producto nuevo
      const index = this.filtered().findIndex(p => p === product);
      this.currentPage.set(Math.floor(Math.max(index, 0) / this.pageSize()) + 1);
      this.showToast(`"${name}" was added.`);
    } else {
      const product = this.target()!;
      // Se modifica el mismo objeto: así el carrito de Sales también ve el cambio
      Object.assign(product, { name, price: d.price!, total: d.total!, category: category || undefined });
      this.refresh();
      this.showToast(`"${name}" was updated.`);
    }

    this.closeModal();
  }

  // ───────── Eliminar ─────────
  protected openDelete(p: InventoryProduct): void {
    this.target.set(p);
    this.open('delete');
  }

  protected confirmDelete(): void {
    const product = this.target();
    if (!product) return;

    const list = this.source();
    const index = list.findIndex(p => p === product || Number(p.id) === Number(product.id));
    if (index !== -1) list.splice(index, 1);

    // Si estaba en el carrito de Sales, también se saca de ahí
    const cart = this.productsService.carryProducts;
    if (cart.some(p => Number(p.id) === Number(product.id))) {
      product.inCarry = 0;
      this.productsService.carryProducts = cart.filter(p => Number(p.id) !== Number(product.id));
    }

    this.refresh();
    this.showToast(`"${product.name}" was deleted.`);
    this.closeModal();
  }

  // ───────── Toast ─────────
  private showToast(text: string): void {
    clearTimeout(this.toastTimer);
    this.toast.set(text);
    this.toastTimer = setTimeout(() => this.toast.set(null), 3500);
  }
}