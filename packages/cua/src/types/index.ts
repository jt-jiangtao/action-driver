// Broad function/array bounds intentionally preserve the original type contract.

export type AnyArray = Array<any>
export type ArrayItem<T extends AnyArray> = T[number]

export type AnyFunction = (...args: any[]) => any
export type Pretty<T> = { [K in keyof T]: T[K] } & unknown
export type Merge<A, B> = Pretty<Omit<A, keyof B> & B>
export * as Param from './parameters.js'
