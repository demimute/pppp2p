import React from 'react';
import GroupCard from './GroupCard.jsx';

function GroupGrid({ groups, onGroupClick, onToggleRemove, onApplyGroupAction }) {
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
      <div className="rounded-[22px] border border-dashed border-gray-300 bg-white px-6 py-20 text-center text-gray-500 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-400">
        暂无相似组，点击上方“开始分析”
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {visibleGroups.map((group, groupIndex) => (
        <GroupCard
          key={group.id}
          group={group}
          groupIndex={groupIndex}
          onClick={(memberIndex) => onGroupClick(group, memberIndex)}
          onToggleRemove={onToggleRemove}
          onApplyGroupAction={onApplyGroupAction}
        />
      ))}
    </div>
  );
}

export default GroupGrid;
