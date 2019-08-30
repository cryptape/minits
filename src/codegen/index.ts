import Debug from 'debug';
import llvm from 'llvm-node';
import ts from 'typescript';

import Stdlib from '../stdlib';
import { Symtab, Value } from '../symtab';
import { StructMeta, StructMetaType } from '../types';
import CodeGenArray from './array-literal-expression';
import CodeGenBinary from './binary-expression';
import CodeGenCall from './call-expression';
import CodeGenDo from './do-statement';
import CodeGenEnum from './enum-declaration';
import CodeGenForOf from './for-of-statement';
import CodeGenFor from './for-statement';
import CodeGenFuncDecl from './function-declaration';
import CodeGenIf from './if-statement';
import CodeGenNumeric from './numeric-expression';
import CodeGenObject from './object-declaration';
import CodeGenPostfixUnary from './postfix-unary-expression';
import CodeGenPrefixUnary from './prefix-unary-expression';
import CodeGenReturn from './return-statement';
import CodeGenString from './string-literal-expression';
import CodeGenVarDecl from './variable-declaration';
import CodeGenWhile from './while-statement';

const debug = Debug('minits:codegen');

debug('codegen');

export default class LLVMCodeGen {
  public readonly builder: llvm.IRBuilder;
  public readonly context: llvm.LLVMContext;
  public readonly module: llvm.Module;
  public readonly symtab: Symtab;
  public readonly stdlib: Stdlib;
  public readonly structTab: Map<string, StructMeta>;

  public readonly cgArray: CodeGenArray;
  public readonly cgBinary: CodeGenBinary;
  public readonly cgCall: CodeGenCall;
  public readonly cgDo: CodeGenDo;
  public readonly cgEnum: CodeGenEnum;
  public readonly cgForOf: CodeGenForOf;
  public readonly cgFor: CodeGenFor;
  public readonly cgFuncDecl: CodeGenFuncDecl;
  public readonly cgIf: CodeGenIf;
  public readonly cgNumeric: CodeGenNumeric;
  public readonly cgObject: CodeGenObject;
  public readonly cgPostfixUnary: CodeGenPostfixUnary;
  public readonly cgPrefixUnary: CodeGenPrefixUnary;
  public readonly cgReturn: CodeGenReturn;
  public readonly cgString: CodeGenString;
  public readonly cgVarDecl: CodeGenVarDecl;
  public readonly cgWhile: CodeGenWhile;

  public currentBreakBlock: llvm.BasicBlock | undefined;
  public currentConitnueBlock: llvm.BasicBlock | undefined;
  public currentFunction: llvm.Function | undefined;
  public currentType: ts.TypeNode | undefined;
  public currentName: string | undefined;

  constructor() {
    this.context = new llvm.LLVMContext();
    this.module = new llvm.Module('main', this.context);
    this.builder = new llvm.IRBuilder(this.context);
    this.symtab = new Symtab();
    this.stdlib = new Stdlib(this);
    this.structTab = new Map();

    this.cgArray = new CodeGenArray(this);
    this.cgBinary = new CodeGenBinary(this);
    this.cgCall = new CodeGenCall(this);
    this.cgDo = new CodeGenDo(this);
    this.cgForOf = new CodeGenForOf(this);
    this.cgFor = new CodeGenFor(this);
    this.cgFuncDecl = new CodeGenFuncDecl(this);
    this.cgIf = new CodeGenIf(this);
    this.cgNumeric = new CodeGenNumeric(this);
    this.cgPostfixUnary = new CodeGenPostfixUnary(this);
    this.cgPrefixUnary = new CodeGenPrefixUnary(this);
    this.cgReturn = new CodeGenReturn(this);
    this.cgString = new CodeGenString(this);
    this.cgVarDecl = new CodeGenVarDecl(this);
    this.cgWhile = new CodeGenWhile(this);
    this.cgEnum = new CodeGenEnum(this);
    this.cgObject = new CodeGenObject(this);

    this.currentBreakBlock = undefined;
    this.currentConitnueBlock = undefined;
    this.currentFunction = undefined;
    this.currentType = undefined;
    this.currentName = undefined;
  }

  public withFunction(func: llvm.Function, body: () => any): any {
    const a = this.currentFunction;
    this.currentFunction = func;
    const r = body();
    this.currentFunction = a;
    return r;
  }

  public withType(type: ts.TypeNode | undefined, body: () => any): any {
    const a = this.currentType;
    this.currentType = type;
    const r = body();
    this.currentType = a;
    return r;
  }

  public withName(name: string | undefined, body: () => any): any {
    const a = this.currentName;
    this.currentName = name;
    const r = body();
    this.currentName = a;
    return r;
  }

  public readName(): string {
    return this.currentName ? this.currentName : 'unnamed';
  }

  public genText(): string {
    return this.module.print();
  }

  public genSourceFile(sourceFile: ts.SourceFile): void {
    sourceFile.forEachChild(node => {
      switch (node.kind) {
        case ts.SyntaxKind.EndOfFileToken:
          return;
        case ts.SyntaxKind.VariableStatement:
          this.genVariableStatement(node as ts.VariableStatement);
          break;
        case ts.SyntaxKind.FunctionDeclaration:
          this.genFunctionDeclaration(node as ts.FunctionDeclaration);
          break;
        case ts.SyntaxKind.EnumDeclaration:
          this.genEnumDeclaration(node as ts.EnumDeclaration);
          break;
        case ts.SyntaxKind.ExpressionStatement:
          this.genExpressionStatement(node as ts.ExpressionStatement);
          break;
        default:
          throw new Error('Unsupported grammar');
      }
    });
  }

  public genNumeric(node: ts.NumericLiteral): llvm.ConstantInt {
    return this.cgNumeric.genNumeric(node);
  }

  public genStringLiteral(node: ts.StringLiteral): llvm.Value {
    return this.cgString.genStringLiteral(node);
  }

  public genBoolean(node: ts.BooleanLiteral): llvm.ConstantInt {
    switch (node.kind) {
      case ts.SyntaxKind.FalseKeyword:
        return llvm.ConstantInt.get(this.context, 0, 1);
      case ts.SyntaxKind.TrueKeyword:
        return llvm.ConstantInt.get(this.context, 1, 1);
      default:
        throw new Error('Unsupported boolean value');
    }
  }

  public genIdentifier(node: ts.Identifier): llvm.Value {
    const symbol = this.symtab.get(node.getText())! as Value;
    let r = symbol.inner;
    for (let i = 0; i < symbol.deref; i++) {
      r = this.builder.createLoad(r);
    }
    return r;
  }

  public genType(type: ts.TypeNode): llvm.Type {
    switch (type.kind) {
      case ts.SyntaxKind.VoidKeyword:
        return llvm.Type.getVoidTy(this.context);
      case ts.SyntaxKind.BooleanKeyword:
        return llvm.Type.getInt1Ty(this.context);
      case ts.SyntaxKind.NumberKeyword:
        return llvm.Type.getInt64Ty(this.context);
      case ts.SyntaxKind.TypeReference:
        const structMeta = this.structTab.get(type.getText())!;
        const structType = this.module.getTypeByName(type.getText())!;

        // if type is enum.
        if (structMeta.metaType === StructMetaType.Enum) {
          return structType.getElementType(0);
        }

        // TODO: impl struct
        throw new Error('Unsupported type');
      case ts.SyntaxKind.TypeLiteral:
        return this.cgObject.genObjectLiteralType(type as ts.TypeLiteralNode);
      case ts.SyntaxKind.StringKeyword:
        return llvm.Type.getInt8PtrTy(this.context);
      default:
        throw new Error(`Unsupported type ${type.kind}`);
    }
  }

  public genBlock(node: ts.Block): void {
    node.statements.forEach(b => {
      this.genStatement(b);
    });
  }

  public genExpression(expr: ts.Expression): llvm.Value {
    switch (expr.kind) {
      case ts.SyntaxKind.NumericLiteral:
        return this.genNumeric(expr as ts.NumericLiteral);
      case ts.SyntaxKind.StringLiteral:
        return this.genStringLiteral(expr as ts.StringLiteral);
      case ts.SyntaxKind.Identifier:
        return this.genIdentifier(expr as ts.Identifier);
      case ts.SyntaxKind.FalseKeyword:
        return this.genBoolean(expr as ts.BooleanLiteral);
      case ts.SyntaxKind.TrueKeyword:
        return this.genBoolean(expr as ts.BooleanLiteral);
      case ts.SyntaxKind.ArrayLiteralExpression:
        return this.genArrayLiteral(expr as ts.ArrayLiteralExpression);
      case ts.SyntaxKind.ElementAccessExpression:
        return this.genElementAccess(expr as ts.ElementAccessExpression);
      case ts.SyntaxKind.CallExpression:
        return this.genCallExpression(expr as ts.CallExpression);
      case ts.SyntaxKind.ParenthesizedExpression:
        return this.genParenthesizedExpression(expr as ts.ParenthesizedExpression);
      case ts.SyntaxKind.PrefixUnaryExpression:
        return this.genPrefixUnaryExpression(expr as ts.PrefixUnaryExpression);
      case ts.SyntaxKind.PostfixUnaryExpression:
        return this.genPostfixUnaryExpression(expr as ts.PostfixUnaryExpression);
      case ts.SyntaxKind.BinaryExpression:
        return this.genBinaryExpression(expr as ts.BinaryExpression);
      case ts.SyntaxKind.PropertyAccessExpression:
        return this.genPropertyAccessExpression(expr as ts.PropertyAccessExpression);
      case ts.SyntaxKind.ObjectLiteralExpression:
        return this.genObjectLiteralExpression(expr as ts.ObjectLiteralExpression);
      default:
        throw new Error('Unsupported expression');
    }
  }

  public genArrayLiteral(node: ts.ArrayLiteralExpression): llvm.AllocaInst {
    return this.cgArray.genArrayLiteral(node);
  }

  public genElementAccess(node: ts.ElementAccessExpression): llvm.Value {
    const type = this.genExpression(node.expression).type;
    if ((type as llvm.PointerType).elementType.isArrayTy()) {
      return this.cgArray.genElementAccess(node);
    }
    return this.cgString.genElementAccess(node);
  }

  public genCallExpression(node: ts.CallExpression): llvm.Value {
    return this.cgCall.genCallExpression(node);
  }

  public genParenthesizedExpression(node: ts.ParenthesizedExpression): llvm.Value {
    return this.genExpression(node.expression);
  }

  public genPrefixUnaryExpression(node: ts.PrefixUnaryExpression): llvm.Value {
    return this.cgPrefixUnary.genPrefixUnaryExpression(node);
  }

  public genPostfixUnaryExpression(node: ts.PostfixUnaryExpression): llvm.Value {
    return this.cgPostfixUnary.genPostfixUnaryExpression(node);
  }

  public genBinaryExpression(node: ts.BinaryExpression): llvm.Value {
    return this.cgBinary.genBinaryExpression(node);
  }

  public genStatement(node: ts.Statement): llvm.Value | void {
    switch (node.kind) {
      case ts.SyntaxKind.Block:
        return this.genBlock(node as ts.Block);
      case ts.SyntaxKind.VariableStatement:
        return this.genVariableStatement(node as ts.VariableStatement);
      case ts.SyntaxKind.ExpressionStatement:
        return this.genExpressionStatement(node as ts.ExpressionStatement);
      case ts.SyntaxKind.IfStatement:
        return this.genIfStatement(node as ts.IfStatement);
      case ts.SyntaxKind.DoStatement:
        return this.genDoStatement(node as ts.DoStatement);
      case ts.SyntaxKind.WhileStatement:
        return this.genWhileStatement(node as ts.WhileStatement);
      case ts.SyntaxKind.ForStatement:
        return this.genForStatement(node as ts.ForStatement);
      case ts.SyntaxKind.ForOfStatement:
        return this.genForOfStatement(node as ts.ForOfStatement);
      case ts.SyntaxKind.ContinueStatement:
        return this.genContinueStatement();
      case ts.SyntaxKind.BreakStatement:
        return this.genBreakStatement();
      case ts.SyntaxKind.ReturnStatement:
        return this.genReturnStatement(node as ts.ReturnStatement);
      case ts.SyntaxKind.EnumDeclaration:
        return this.genEnumDeclaration(node as ts.EnumDeclaration);
      default:
        throw new Error('Unsupported statement');
    }
  }

  public genVariableDeclaration(node: ts.VariableDeclaration): llvm.Value {
    return this.cgVarDecl.genVariableDeclaration(node);
  }

  public genVariableStatement(node: ts.VariableStatement): void {
    node.declarationList.declarations.forEach(item => {
      this.genVariableDeclaration(item);
    });
  }

  public genExpressionStatement(node: ts.ExpressionStatement): llvm.Value {
    return this.genExpression(node.expression);
  }

  public genContinueStatement(): void {
    this.builder.createBr(this.currentConitnueBlock!);
  }

  public genBreakStatement(): void {
    this.builder.createBr(this.currentBreakBlock!);
  }

  public genReturnStatement(node: ts.ReturnStatement): llvm.Value {
    return this.cgReturn.genReturnStatement(node);
  }

  public genFunctionDeclaration(node: ts.FunctionDeclaration): llvm.Function {
    return this.cgFuncDecl.genFunctionDeclaration(node);
  }

  public genIfStatement(node: ts.IfStatement): void {
    return this.cgIf.genIfStatement(node);
  }

  public genDoStatement(node: ts.DoStatement): void {
    return this.cgDo.genDoStatement(node);
  }

  public genWhileStatement(node: ts.WhileStatement): void {
    return this.cgWhile.genWhileStatement(node);
  }

  public genForStatement(node: ts.ForStatement): void {
    return this.cgFor.genForStatement(node);
  }

  public genForOfStatement(node: ts.ForOfStatement): void {
    return this.cgForOf.genForOfStatement(node);
  }

  public genEnumDeclaration(node: ts.EnumDeclaration): void {
    return this.cgEnum.genEnumDeclaration(node);
  }

  public genPropertyAccessExpression(node: ts.PropertyAccessExpression): llvm.Value {
    const varName = (node.expression as ts.Identifier).getText();
    const structMeta = this.structTab.get(varName);

    // enum
    if (structMeta) {
      return this.cgEnum.genEnumElementAccess(node);
    }

    return this.cgObject.genObjectElementAccess(node);
  }

  public genPropertyAccessExpressionPtr(node: ts.PropertyAccessExpression): llvm.Value {
    return this.cgObject.genObjectElementAccessPtr(node);
  }

  public genObjectLiteralExpression(node: ts.ObjectLiteralExpression): llvm.Value {
    return this.cgObject.genObjectLiteralExpression(node);
  }

  public initObjectInst(varName: string, type: llvm.Type, values: llvm.Constant[]): llvm.Value {
    return this.cgObject.initObjectInst(varName, type, values);
  }
}
