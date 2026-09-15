import {
  Address,
  Cell,
  Zero,
  fixedPointToString,
  numFrom,
  type CellOutput,
  type Client,
  type Num,
  type Script,
  type Transaction,
} from "@ckb-ccc/core";
import { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import {
  ActivityIndicator,
  Divider,
  Icon,
  List,
  Text,
  useTheme,
} from "react-native-paper";

import { useI18n, type Translate } from "../i18n";

type TransactionCellView = {
  cellOutput?: CellOutput;
  extraCapacity?: Num;
  key: string;
  label: string;
  outputData?: string;
  reference?: string;
};

type InputResolution = {
  cells: TransactionCellView[];
  client: Client;
  transaction: Transaction;
};

type FeeResolution = {
  client: Client;
  transaction: Transaction;
  value: Num | null;
};

export function TransactionApprovalDetails({
  client,
  transaction,
}: {
  client: Client;
  transaction: Transaction;
}) {
  const { t } = useI18n();
  const [inputResolution, setInputResolution] = useState<InputResolution>();
  const [feeResolution, setFeeResolution] = useState<FeeResolution>();
  const inputs =
    inputResolution?.client === client &&
    inputResolution.transaction === transaction
      ? inputResolution.cells
      : undefined;
  const fee =
    feeResolution?.client === client && feeResolution.transaction === transaction
      ? feeResolution.value
      : undefined;

  useEffect(() => {
    let active = true;

    void Promise.all(
      transaction.inputs.map(async (input, index) => {
        const reference = `${input.previousOutput.txHash}:${input.previousOutput.index}`;
        try {
          const cell =
            input.cellOutput && input.outputData !== undefined
              ? Cell.from({
                  cellOutput: input.cellOutput,
                  outPoint: input.previousOutput,
                  outputData: input.outputData,
                })
              : await client.getCell(input.previousOutput);
          let extraCapacity: Num | undefined;
          if (cell) {
            try {
              extraCapacity = await cell.getDaoProfit(client);
            } catch {
              // DAO compensation is optional; keep the resolved cell visible.
            }
          }
          return {
            cellOutput: cell?.cellOutput,
            extraCapacity,
            key: reference,
            label: t("inputNumber", { number: index + 1 }),
            outputData: cell?.outputData,
            reference,
          };
        } catch {
          return {
            key: reference,
            label: t("inputNumber", { number: index + 1 }),
            reference,
          };
        }
      }),
    ).then((cells) => {
      if (active) {
        setInputResolution({ cells, client, transaction });
      }
    });

    void transaction
      .getFee(client)
      .then((value) => {
        if (active) {
          setFeeResolution({ client, transaction, value });
        }
      })
      .catch(() => {
        if (active) {
          setFeeResolution({ client, transaction, value: null });
        }
      });

    return () => {
      active = false;
    };
  }, [client, t, transaction]);

  const outputs = transaction.outputs.map((cellOutput, index) => ({
    cellOutput,
    key: `output-${index}`,
    label: t("outputNumber", { number: index + 1 }),
    outputData: transaction.outputsData[index] ?? "0x",
  }));

  return (
    <View style={styles.details}>
      <View style={styles.metadataBlock}>
        <Text variant="labelMedium">{t("transactionHash")}</Text>
        <Text variant="bodySmall" selectable style={styles.mono}>
          {transaction.hash()}
        </Text>
      </View>
      <View style={styles.feeRow}>
        <View style={styles.metadataBlock}>
          <Text variant="labelMedium">{t("fee")}</Text>
          <Text variant="bodyLarge">
            {fee === undefined
              ? t("parsing")
              : fee === null
                ? t("unableToParse")
                : `${fixedPointToString(fee)} CKB`}
          </Text>
        </View>
        {fee !== undefined && fee !== null ? (
          <View style={[styles.metadataBlock, styles.feeRate]}>
            <Text variant="labelMedium">{t("feeRate")}</Text>
            <Text variant="bodyMedium">
              {t("shannonsPerKb", {
                rate: transactionFeeRate(transaction, fee).toString(),
              })}
            </Text>
          </View>
        ) : null}
      </View>
      <TransactionCellGroup
        cells={inputs}
        client={client}
        empty={t("noInputs")}
        loadingCount={transaction.inputs.length}
        title={t("inputs")}
        t={t}
      />
      <TransactionCellGroup
        cells={outputs}
        client={client}
        empty={t("noOutputs")}
        loadingCount={transaction.outputs.length}
        title={t("outputs")}
        t={t}
      />
    </View>
  );
}

function TransactionCellGroup({
  cells,
  client,
  empty,
  loadingCount,
  title,
  t,
}: {
  cells?: TransactionCellView[];
  client: Client;
  empty: string;
  loadingCount: number;
  title: string;
  t: Translate;
}) {
  const totalCapacity =
    cells?.reduce(
      (total, cell) => total + transactionCellCapacity(cell),
      Zero,
    ) ?? Zero;

  return (
    <View style={styles.cellGroup}>
      <View style={styles.cellGroupHeading}>
        <Text variant="titleMedium">{title}</Text>
        <Text variant="labelLarge">
          {cells
            ? t("cellGroupSummary", {
                count: cells.length,
                capacity: fixedPointToString(totalCapacity),
              })
            : t("itemCount", { count: loadingCount })}
        </Text>
      </View>
      <Divider />
      {cells === undefined ? (
        <View style={styles.statusRow}>
          <ActivityIndicator size="small" />
          <Text variant="bodyMedium">{t("loadingCells")}</Text>
        </View>
      ) : cells.length === 0 ? (
        <Text variant="bodyMedium" style={styles.statusText}>
          {empty}
        </Text>
      ) : (
        cells.map((cell, index) => (
          <View key={cell.key}>
            {index > 0 ? <Divider /> : null}
            <TransactionCellItem cell={cell} client={client} t={t} />
          </View>
        ))
      )}
    </View>
  );
}

function TransactionCellItem({
  cell,
  client,
  t,
}: {
  cell: TransactionCellView;
  client: Client;
  t: Translate;
}) {
  const theme = useTheme();

  if (!cell.cellOutput) {
    return (
      <View style={styles.unavailableCell}>
        <Text variant="titleSmall">{cell.label}</Text>
        <Text variant="bodySmall">{t("cellDetailsUnavailable")}</Text>
        {cell.reference ? (
          <Text variant="bodySmall" selectable style={styles.mono}>
            {cell.reference}
          </Text>
        ) : null}
      </View>
    );
  }

  const lockAddress = Address.fromScript(cell.cellOutput.lock, client).toString();
  const capacity = transactionCellCapacity(cell);

  return (
    <List.Accordion
      title={cell.label}
      description={lockAddress}
      descriptionNumberOfLines={1}
      titleStyle={styles.cellTitle}
      descriptionStyle={styles.mono}
      contentStyle={styles.cellAccordionContent}
      right={({ isExpanded }) => (
        <View style={styles.cellRight}>
          <Text
            variant="labelLarge"
            numberOfLines={2}
            style={styles.capacity}
          >
            {fixedPointToString(capacity)} CKB
          </Text>
          <Icon
            source={isExpanded ? "chevron-up" : "chevron-down"}
            size={24}
            color={theme.colors.onSurfaceVariant}
          />
        </View>
      )}
    >
      <View
        style={[
          styles.expandedCell,
          { backgroundColor: theme.colors.surfaceVariant },
        ]}
      >
        {cell.extraCapacity && cell.extraCapacity > Zero ? (
          <TransactionCellField
            label={t("daoCompensation")}
            value={`${fixedPointToString(cell.extraCapacity)} CKB`}
          />
        ) : null}
        {cell.reference ? (
          <TransactionCellField label={t("outpoint")} value={cell.reference} />
        ) : null}
        <TransactionScriptDetails
          address={lockAddress}
          label={t("lockScript")}
          script={cell.cellOutput.lock}
          t={t}
        />
        <TransactionScriptDetails
          label={t("typeScript")}
          script={cell.cellOutput.type}
          t={t}
        />
        <TransactionCellField
          label={t("data")}
          value={cell.outputData ?? "0x"}
        />
      </View>
    </List.Accordion>
  );
}

function TransactionScriptDetails({
  address,
  label,
  script,
  t,
}: {
  address?: string;
  label: string;
  script?: Script;
  t: Translate;
}) {
  if (!script) {
    return <TransactionCellField label={label} value={t("none")} />;
  }

  return (
    <View style={styles.scriptDetails}>
      <Text variant="labelLarge">{label}</Text>
      {address ? (
        <TransactionCellField label={t("address")} value={address} />
      ) : null}
      <TransactionCellField label={t("codeHash")} value={script.codeHash} />
      <TransactionCellField label={t("hashType")} value={script.hashType} />
      <TransactionCellField label={t("arguments")} value={script.args} />
    </View>
  );
}

function TransactionCellField({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metadataBlock}>
      <Text variant="labelSmall">{label}</Text>
      <Text variant="bodySmall" selectable style={styles.mono}>
        {value}
      </Text>
    </View>
  );
}

export function transactionCellCapacity(cell: TransactionCellView): Num {
  return (cell.cellOutput?.capacity ?? Zero) + (cell.extraCapacity ?? Zero);
}

export function transactionFeeRate(transaction: Transaction, fee: Num): Num {
  return (fee * numFrom(1000)) / numFrom(transaction.toBytes().length + 4);
}

const styles = StyleSheet.create({
  details: { gap: 20 },
  metadataBlock: { gap: 4 },
  mono: { fontFamily: "monospace" },
  feeRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    gap: 16,
  },
  feeRate: { alignItems: "flex-end" },
  cellGroup: { gap: 0 },
  cellGroupHeading: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  statusRow: {
    minHeight: 56,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
  },
  statusText: { paddingHorizontal: 16, paddingVertical: 18 },
  unavailableCell: { gap: 4, paddingHorizontal: 16, paddingVertical: 14 },
  cellAccordionContent: { paddingLeft: 0 },
  cellTitle: { fontWeight: "600" },
  cellRight: {
    maxWidth: "48%",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 4,
  },
  capacity: { flexShrink: 1, textAlign: "right" },
  expandedCell: { gap: 16, paddingHorizontal: 16, paddingVertical: 16 },
  scriptDetails: { gap: 10 },
});
