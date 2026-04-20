import { useState, useCallback } from 'react';
import { getGroups } from './useApi.js';

export function useGroups() {
  const [groups, setGroups] = useState([]);
  const [stats, setStats] = useState({ total_groups: 0, to_remove: 0, to_keep: 0 });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetchGroups = useCallback(async (params) => {
    setLoading(true);
    setError(null);

    try {
      const result = await getGroups(params);
      if (result) {
        setGroups(result.groups || []);
        setStats(result.stats || { total_groups: 0, to_remove: 0, to_keep: 0 });
      }
    } catch (err) {
      console.error('Groups fetch error:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const updateGroupMember = useCallback((groupId, memberName, updates) => {
    setGroups(prev => prev.map(group => {
      if (group.id === groupId) {
        return {
          ...group,
          members: group.members.map(member => {
            if (member.name === memberName) {
              return { ...member, ...updates };
            }
            return member;
          }),
        };
      }
      return group;
    }));

    // Update stats
    setStats(prev => {
      const delta = updates.to_remove ? 1 : -1;
      return {
        ...prev,
        to_remove: prev.to_remove + delta,
        to_keep: prev.to_keep - delta,
      };
    });
  }, []);

  const markForRemoval = useCallback((groupId, memberName) => {
    updateGroupMember(groupId, memberName, { to_remove: true });
  }, [updateGroupMember]);

  const markForKeep = useCallback((groupId, memberName) => {
    updateGroupMember(groupId, memberName, { to_remove: false });
  }, [updateGroupMember]);

  const clearGroups = useCallback(() => {
    setGroups([]);
    setStats({ total_groups: 0, to_remove: 0, to_keep: 0 });
  }, []);

  return {
    groups,
    stats,
    loading,
    error,
    fetchGroups,
    updateGroupMember,
    markForRemoval,
    markForKeep,
    clearGroups,
  };
}
