import React from 'react';
import GroupCard from './GroupCard.jsx';

function GroupGrid({ groups, onGroupClick, selectedStrategy }) {
  const visibleGroups = (groups || []).filter((group) => {
    const visibleMembers = (group.members || []).filter((member) => {
      if (!member?.name) return false;
      if (member.removed || member.hidden) return false;
      return !!(member.path || member.name);
    });
    return visibleMembers.length >= 2;
  });

  if (visibleGroups.length === 0) {
    return (
      <div className="text-center py-12">
        <div className="text-5xl mb-4">📭</div>
        <p className="text-gray-500 dark:text-gray-400">
          暂无相似组，点击"开始分析"扫描重复照片
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {visibleGroups.map((group, groupIndex) => (
        <GroupCard
          key={group.id}
          group={group}
          groupIndex={groupIndex}
          onClick={(memberIndex) => onGroupClick(group, memberIndex)}
          selectedStrategy={selectedStrategy}
        />
      ))}
    </div>
  );
}

export default GroupGrid;
