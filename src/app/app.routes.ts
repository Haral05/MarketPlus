import { Routes } from '@angular/router';
import { SalesComponent } from './sales-component/sales-component';
import { InventoryComponent } from './inventory-component/inventory-component';
import { DashboardComponent } from './dashboard-component/dashboard-component';
import { HistoryComponent } from './history-component/history-component';

export const routes: Routes = [
    { path: '', redirectTo: 'sales', pathMatch: 'full' },
    { path:'sales', component: SalesComponent },
    { path:'inventory', component: InventoryComponent },
    { path:'dashboard', component: DashboardComponent },
    { path:'history', component: HistoryComponent },
    

];
