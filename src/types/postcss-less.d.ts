declare module 'postcss-less' {
    import { Parser, Root, Stringifier } from 'postcss';

    export const parse: Parser<Root>;
    export const stringify: Stringifier;
}
