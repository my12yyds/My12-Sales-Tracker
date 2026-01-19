/**
 * 状态映射工具
 */

// 状态映射：英文 -> 中文
const STATUS_MAP = {
  'NEW': '未联系',
  'CONTACTED': '已联系',
  'QUOTED': '已报价',
  'WON': '成交',
  'LOST': '流失'
};

/**
 * 将英文状态转换为中文
 * @param {string} status 英文状态
 * @returns {string} 中文状态
 */
function getStatusText(status) {
  if (!status) return '';
  return STATUS_MAP[status] || status;
}

/**
 * 获取所有状态选项（用于下拉选择）
 */
function getStatusOptions() {
  return [
    { label: '未联系', value: 'NEW' },
    { label: '已联系', value: 'CONTACTED' },
    { label: '已报价', value: 'QUOTED' },
    { label: '成交', value: 'WON' },
    { label: '流失', value: 'LOST' }
  ];
}

/**
 * 获取筛选状态选项（包含"全部状态"）
 */
function getFilterStatusOptions() {
  return [
    { label: '全部状态', value: '' },
    ...getStatusOptions()
  ];
}

module.exports = {
  getStatusText,
  getStatusOptions,
  getFilterStatusOptions,
  STATUS_MAP
};
