import { NgFor } from '@angular/common';
import { Component, computed, signal } from '@angular/core';
import { GetProductService } from '../get-product-service';
import { Product } from '../interfaces/product.interface';

@Component({
  imports: [NgFor],
  selector: 'app-inventory-component',
  styleUrl: './inventory-component.css',
  templateUrl: './inventory-component.html',
})
export class InventoryComponent {
  protected sortCategorie:string = 'All categories';
  protected sortStock:string = 'High';
  protected sortCategorieArray:string[] = ['All categories', 'option 1', 'option 2', 'option 3', '3', '4'];
  protected sortStockArray:string[] = ['High', 'Medium', 'Low', 'Out'];
  protected allProducts!:Product[];

  protected pageSize = signal(10);
  protected currentPage = signal(1);

  protected totalPages = computed(() =>
    Math.ceil(this.allProducts.length / this.pageSize()));

  protected visibleProducts = computed(() => {
    const start = (this.currentPage() - 1) * this.pageSize();
    const end = start + this.pageSize();
    return this.allProducts.slice(start, end);
  });
  
  protected visiblePages = computed<number[]>(() => {
    const total = this.totalPages();
    const current = this.currentPage();
    const pages:number[] = [];

    if(total <= 7){
      for(let i=0; i<total; i++){
        pages.push(i+1);
      }
      return pages;
    }

    if(current <= 4){
      return [1,2,3,4,5,-1,total];
    }

    if(current >= (total -3)){
      return [1, -1, total-4, total-3, total-2, total-1, total];
    }

    return [1, -1, current-1, current, current+1, -1, total];

  });

  constructor(private productsService:GetProductService){
    this.allProducts = productsService.getProducts();
  }

  selectCategorie(event:Event){
   const elementSelected:string = (event.target as HTMLElement).textContent?.trim();
   this.sortCategorie = elementSelected;
   
   this.sortItemHidden(1);
   
  }

  selectStock(event:Event){
    const elementSelected:string = (event.target as HTMLElement).textContent?.trim();
    this.sortStock = elementSelected;

    this.sortItemHidden(2);
  }

  sortItemShow(number:Number){
    
    const element = document.querySelector<HTMLElement>('.div_inventory_sort_item_select'+number);
    if(element){
      element.style.display = 'initial';
    }
  }

  sortItemHidden(number:Number){
    const element = document.querySelector<HTMLElement>('.div_inventory_sort_item_select'+number);
    if(element){
      element.style.display = 'none';

    }
  }

  
  goToPage(page: number) {
    if (page < 1 || page > this.totalPages()) return;  // guard
    this.currentPage.set(page);
  }

  nextPage() { this.goToPage(this.currentPage() + 1); }
  prevPage() { this.goToPage(this.currentPage() - 1); }

}
