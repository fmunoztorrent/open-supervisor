import React from 'react';
import { TouchableOpacity, View, Text, StyleSheet } from 'react-native';
import { AuthorizationRequestDto, RequestType } from '@open-supervisor/shared-types';

type RequestWithResolved = AuthorizationRequestDto & {
  resolved?: 'APPROVED' | 'REJECTED';
};

interface AuthorizationCardProps {
  request: RequestWithResolved;
  onPress: () => void;
}

function formatDate(isoString: string): string {
  try {
    const date = new Date(isoString);
    const hours = date.getUTCHours().toString().padStart(2, '0');
    const minutes = date.getUTCMinutes().toString().padStart(2, '0');
    const month = (date.getUTCMonth() + 1).toString().padStart(2, '0');
    const day = date.getUTCDate().toString().padStart(2, '0');
    return `${month}/${day} ${hours}:${minutes}`;
  } catch {
    return isoString;
  }
}

function getBadgeLabel(resolved?: 'APPROVED' | 'REJECTED'): string {
  if (resolved === 'APPROVED') return 'Autorizada';
  if (resolved === 'REJECTED') return 'Rechazada';
  return 'Pendiente';
}

const TYPE_COLORS: Record<RequestType, string> = {
  [RequestType.DISCOUNT]: '#2196F3',
  [RequestType.CANCEL]: '#F44336',
  [RequestType.EMPLOYEE_BENEFIT]: '#9C27B0',
  [RequestType.SUSPEND]: '#FF9800',
  [RequestType.PRICE_CHANGE]: '#4CAF50',
};

export const AuthorizationCard: React.FC<AuthorizationCardProps> = ({
  request,
  onPress,
}) => {
  const badgeLabel = getBadgeLabel(request.resolved);
  const typeColor = TYPE_COLORS[request.type] ?? '#607D8B';

  return (
    <TouchableOpacity
      testID="authorization-card"
      onPress={onPress}
      style={styles.container}
    >
      <View
        testID={`type-icon-${request.type}`}
        style={[styles.typeIndicator, { backgroundColor: typeColor }]}
      />
      <View style={styles.content}>
        <Text style={styles.type}>{request.type}</Text>
        <Text style={styles.posId}>{request.pos_id}</Text>
        <Text testID="card-created-at" style={styles.createdAt}>
          {formatDate(request.created_at)}
        </Text>
      </View>
      <View style={styles.badge}>
        <Text style={styles.badgeText}>{badgeLabel}</Text>
      </View>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    marginVertical: 4,
    marginHorizontal: 8,
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    elevation: 2,
  },
  typeIndicator: {
    width: 8,
    borderRadius: 4,
    alignSelf: 'stretch',
    marginRight: 12,
  },
  content: {
    flex: 1,
  },
  type: {
    fontSize: 14,
    fontWeight: '600',
    color: '#212121',
  },
  posId: {
    fontSize: 12,
    color: '#616161',
    marginTop: 2,
  },
  createdAt: {
    fontSize: 11,
    color: '#9E9E9E',
    marginTop: 2,
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: '#EEEEEE',
    borderRadius: 12,
  },
  badgeText: {
    fontSize: 11,
    color: '#424242',
  },
});
