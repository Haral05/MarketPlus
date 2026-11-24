import { Service } from '@angular/core';
import { Product } from './interfaces/product.interface';

@Service()
export class GetProductService {

    private products:Product[] = [
        {id:1, name:'Calabaza', price:1.3, total: 3, inCarry:0},
        {id:2, name:'Boniato', price:1.6, total: 18, inCarry:0},
        {id:3, name:'Azucar', price:154, total: 588888, inCarry:0},
        {id:4, name:'Arroz', price:54, total: 0, inCarry:0},
        {id:5, name:'Zapato', price:52.4, total: 10, inCarry:0},
        {id:6, name:'Zapato', price:52.4, total: 1000, inCarry:0},
        {id:7, name:'Zapato', price:52.4, total: 1, inCarry:0},
        {id:8, name:'Zapato', price:52.4, total: 104, inCarry:0},
        {id:9, name:'Zapato', price:52.4, total: 10, inCarry:0},
        {id:10, name:'Zapato', price:52.4, total: 0, inCarry:0},
        {id:11, name:'Zapato', price:52.4, total: 0, inCarry:0},
        {id:12, name:'Zapato', price:52.4, total: 3, inCarry:0},
        {id:13, name:'Zapato', price:52444444.4, total: 1000, inCarry:0},
        
        
    ]

    public carryProducts:Product[] = [];

    getProducts():Product[]{
        return this.products;
    }
    getProductById(id:number): Product | undefined{
        return this.products.find(product => product.id === id);
    }

    getProductByName(name:string):Product | undefined{
        return this.products.find(product => product.name.toLowerCase() === name.toLowerCase());
    }

    getProductsFromCarry():number{
        let totalCarry = 0;
        for(let i=0; i<this.carryProducts.length; i++){
            totalCarry = totalCarry + this.carryProducts[i].inCarry * this.carryProducts[i].price;
        }
        return totalCarry;
    }
}
