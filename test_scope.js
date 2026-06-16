import vm from 'vm';

console.log("Testing JS scoping...");

const context = vm.createContext({ window: {} });
vm.runInContext('window.PaiementPro = function() { this.isFallback = true; };', context);
vm.runInContext('class PaiementPro { constructor() { this.isReal = true; } }', context);

console.log("Lexical value:", vm.runInContext('PaiementPro.toString().includes("class") ? "class" : "func"', context));
console.log("Window property:", vm.runInContext('window.PaiementPro.toString().includes("class") ? "class" : "func"', context));
