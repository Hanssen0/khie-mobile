import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { Card, Icon, Text, useTheme } from "react-native-paper";

export function InfoCard({
  centerContent = false,
  description,
  descriptionNumberOfLines,
  icon,
  onPress,
  showExternalLink = false,
  supportingText,
  title,
}: {
  centerContent?: boolean;
  description: string;
  descriptionNumberOfLines?: number;
  icon: (props: { color: string; size: number }) => ReactNode;
  onPress?: () => void;
  showExternalLink?: boolean;
  supportingText?: string;
  title: string;
}) {
  const theme = useTheme();

  return (
    <Card mode="elevated" onPress={onPress}>
      <Card.Content style={styles.content}>
        <View style={[styles.icon, showExternalLink && styles.centeredAccessory]}>
          {icon({ color: theme.colors.onSurfaceVariant, size: 30 })}
        </View>
        <View style={[styles.copy, centerContent && styles.centeredCopy]}>
          <Text variant="titleMedium">{title}</Text>
          <Text
            variant="bodyMedium"
            numberOfLines={descriptionNumberOfLines}
            style={{ color: theme.colors.onSurfaceVariant }}
          >
            {description}
          </Text>
          {supportingText ? (
            <Text
              variant="bodySmall"
              style={{ color: theme.colors.onSurfaceVariant }}
            >
              {supportingText}
            </Text>
          ) : null}
        </View>
        {showExternalLink ? (
          <View style={styles.centeredAccessory}>
            <Icon
              source="open-in-new"
              size={20}
              color={theme.colors.onSurfaceVariant}
            />
          </View>
        ) : null}
      </Card.Content>
    </Card>
  );
}

const styles = StyleSheet.create({
  content: {
    minHeight: 104,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    paddingVertical: 16,
  },
  icon: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  centeredAccessory: { alignSelf: "center" },
  centeredCopy: { alignSelf: "center" },
  copy: { flex: 1, gap: 4 },
});
