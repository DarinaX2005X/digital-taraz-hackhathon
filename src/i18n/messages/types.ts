export type MessageTree = { readonly [key: string]: string | MessageTree };
export type MessageShape<T> = { readonly [K in keyof T]: T[K] extends string ? string : MessageShape<T[K]> };
export type MessageKey<T> = { [K in keyof T & string]: T[K] extends string ? K : T[K] extends MessageTree ? `${K}.${MessageKey<T[K]>}` : never }[keyof T & string];
