import { entityKind } from '~/entity';
import { QueryPromise } from '~/query-promise';
import {
	type BuildQueryResult,
	type DBQueryConfig,
	mapRelationalRow,
	type TableRelationalConfig,
	type TablesRelationalConfig,
} from '~/relations';
import type { SQL } from '~/sql';
import { tracer } from '~/tracing';
import { type KnownKeysOnly } from '~/utils';
import type { PgDialect } from '../dialect';
import type { PgSession, PreparedQuery, PreparedQueryConfig } from '../session';
import { type AnyPgTable } from '../table';

export class RelationalQueryBuilder<TSchema extends TablesRelationalConfig, TFields extends TableRelationalConfig> {
	static readonly [entityKind]: string = 'PgRelationalQueryBuilder';

	constructor(
		private fullSchema: Record<string, unknown>,
		private schema: TSchema,
		private tableNamesMap: Record<string, string>,
		private table: AnyPgTable,
		private tableConfig: TableRelationalConfig,
		private dialect: PgDialect,
		private session: PgSession,
	) {}

	findMany<TConfig extends DBQueryConfig<'many', true, TSchema, TFields>>(
		config?: KnownKeysOnly<TConfig, DBQueryConfig<'many', true, TSchema, TFields>>,
	): PgRelationalQuery<BuildQueryResult<TSchema, TFields, TConfig>[]> {
		return new PgRelationalQuery(
			this.fullSchema,
			this.schema,
			this.tableNamesMap,
			this.table,
			this.tableConfig,
			this.dialect,
			this.session,
			config ? (config as DBQueryConfig<'many', true>) : {},
			'many',
		);
	}

	findFirst<TSelection extends Omit<DBQueryConfig<'many', true, TSchema, TFields>, 'limit'>>(
		config?: KnownKeysOnly<TSelection, Omit<DBQueryConfig<'many', true, TSchema, TFields>, 'limit'>>,
	): PgRelationalQuery<BuildQueryResult<TSchema, TFields, TSelection> | undefined> {
		return new PgRelationalQuery(
			this.fullSchema,
			this.schema,
			this.tableNamesMap,
			this.table,
			this.tableConfig,
			this.dialect,
			this.session,
			config ? { ...(config as DBQueryConfig<'many', true> | undefined), limit: 1 } : { limit: 1 },
			'first',
		);
	}
}

export class PgRelationalQuery<TResult> extends QueryPromise<TResult> {
	static readonly [entityKind]: string = 'PgRelationalQuery';

	declare protected $brand: 'PgRelationalQuery';

	constructor(
		private fullSchema: Record<string, unknown>,
		private schema: TablesRelationalConfig,
		private tableNamesMap: Record<string, string>,
		private table: AnyPgTable,
		private tableConfig: TableRelationalConfig,
		private dialect: PgDialect,
		private session: PgSession,
		private config: DBQueryConfig<'many', true> | true,
		private mode: 'many' | 'first',
	) {
		super();
	}

	private _prepare(name?: string): PreparedQuery<PreparedQueryConfig & { execute: TResult }> {
		return tracer.startActiveSpan('drizzle.prepareQuery', () => {
			const query = this.dialect.buildRelationalQuery(
				this.fullSchema,
				this.schema,
				this.tableNamesMap,
				this.table,
				this.tableConfig,
				this.config,
				this.tableConfig.tsName,
				[],
				true,
			);

			const builtQuery = this.dialect.sqlToQuery(query.sql as SQL);
			return this.session.prepareQuery<PreparedQueryConfig & { execute: TResult }>(
				builtQuery,
				undefined,
				name,
				(rawRows, mapColumnValue) => {
					const rows = rawRows.map((row) =>
						mapRelationalRow(this.schema, this.tableConfig, row, query.selection, mapColumnValue)
					);
					if (this.mode === 'first') {
						return rows[0] as TResult;
					}
					return rows as TResult;
				},
			);
		});
	}

	prepare(name: string): PreparedQuery<PreparedQueryConfig & { execute: TResult }> {
		return this._prepare(name);
	}

	override execute(): Promise<TResult> {
		return tracer.startActiveSpan('drizzle.operation', () => {
			return this._prepare().execute();
		});
	}
}
