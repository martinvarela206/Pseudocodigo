# Declaración de Arreglos - Sintaxis Actualizada

## Tipos Soportados

Los arreglos en pseudocódigo ahora se declaran usando los tipos básicos:
- `entero` - números enteros
- `cadena` - textos/cadenas de caracteres
- `caracter` - un único carácter
- `booleano` - valores verdadero/falso

## Sintaxis de Declaración

```
<tipo> <nombre_variable>[<cantidad_de_elementos>]
```

## Ejemplos

### Arreglo de Enteros
```pseudocodigo
entero numeros[5]
```
Crea un arreglo de 5 números enteros, inicializados en 0.

**C generado:**
```c
int numeros[5];
```

**JavaScript generado:**
```javascript
let numeros = Array(5).fill(0);
```

### Arreglo de Cadenas
```pseudocodigo
cadena nombres[3]
```
Crea un arreglo de 3 cadenas de texto, inicializadas como strings vacíos.

**C generado:**
```c
char nombres[3][100];
```

**JavaScript generado:**
```javascript
let nombres = Array(3).fill("");
```

### Arreglo de Caracteres
```pseudocodigo
caracter letras[10]
```
Crea un arreglo de 10 caracteres, inicializados en 0.

**C generado:**
```c
char letras[10];
```

**JavaScript generado:**
```javascript
let letras = Array(10).fill(0);
```

### Arreglo de Booleanos
```pseudocodigo
booleano flags[4]
```
Crea un arreglo de 4 valores booleanos, inicializados en falso.

**C generado:**
```c
int flags[4];
```

**JavaScript generado:**
```javascript
let flags = Array(4).fill(false);
```

## Acceso a Elementos

El acceso a elementos usa la **indexación base-1** (como es común en pseudocódigo):

```pseudocodigo
entero numeros[5]
leer numeros[1]        // Lee el primer elemento
leer numeros[5]        // Lee el último elemento
```

Internamente se traducen a base-0 para C y JavaScript:
- `numeros[1]` → `numeros[0]` (primer elemento)
- `numeros[5]` → `numeros[4]` (último elemento)

## Ejemplo Completo

```pseudocodigo
entero calificaciones[3]
leer calificaciones[1]
leer calificaciones[2]
leer calificaciones[3]

promedio = (calificaciones[1] + calificaciones[2] + calificaciones[3]) / 3
escribir promedio
```
