import { Request, Response } from 'express';
import { Transaction } from '../models/Transaction';
import { asyncHandler } from '../utils/asyncHandler';
import { ApiResponse } from '../utils/ApiResponse';
import ExcelJS from 'exceljs';
import { env } from '../config/env';
import { isExpandedLedgerEnabled } from '../config/features';
import { ledgerMovementTotals } from '../services/ledgerRead.service';

export const getComprehensiveReport = asyncHandler(async (req: Request, res: Response) => {
  const { startDate, endDate, cashierId, walletProvider, customerId, status } = req.query;

  const matchQuery: any = {};

  if (status) {
    matchQuery.status = status;
  } else {
    matchQuery.status = 'COMPLETED';
  }

  if (startDate || endDate) {
    matchQuery.createdAt = {};
    if (startDate) matchQuery.createdAt.$gte = new Date(startDate as string);
    if (endDate) {
      const end = new Date(endDate as string);
      end.setHours(23, 59, 59, 999);
      matchQuery.createdAt.$lte = end;
    }
  }

  if (cashierId) matchQuery.cashierId = cashierId;
  if (walletProvider) matchQuery.walletProvider = walletProvider;
  if (customerId) matchQuery.customerId = customerId;

  const transactions = await Transaction.find(matchQuery)
    .populate('customerId', 'name phone customerNumber')
    .populate('cashierId', 'name email role')
    .sort({ createdAt: -1 });

  const completed = transactions.filter(transaction => transaction.status === 'COMPLETED');
  const totalVolumeUSD = completed.reduce((acc, t) => acc + (t.amountReceivedUSD ?? t.amountReceived ?? 0), 0);
  const totalServiceFeesUSD = completed.reduce((acc, t) => acc + (t.serviceFeeUSD ?? t.serviceFee ?? 0), 0);
  const totalCashPaidOutUGX = completed.reduce((acc, t) => acc + (t.cashPaidUGX ?? t.cashPaid ?? 0), 0);
  const totalProfitUSD = completed.reduce((acc, t) => acc + (t.profitUSD ?? t.profit ?? 0), 0);

  // Cashier Performance Aggregation
  const cashierMap: { [key: string]: { name: string; volumeUSD: number; feeUSD: number; count: number } } = {};
  completed.forEach((t) => {
    const cName = (t.cashierId as any)?.name || 'Unknown Cashier';
    if (!cashierMap[cName]) {
      cashierMap[cName] = { name: cName, volumeUSD: 0, feeUSD: 0, count: 0 };
    }
    cashierMap[cName].volumeUSD += t.amountReceivedUSD ?? t.amountReceived ?? 0;
    cashierMap[cName].feeUSD += t.serviceFeeUSD ?? t.serviceFee ?? 0;
    cashierMap[cName].count += 1;
  });
  const topCashiers = Object.values(cashierMap).sort((a, b) => b.volumeUSD - a.volumeUSD);

  // Customer Aggregation
  const customerMap: { [key: string]: { name: string; phone: string; volumeUSD: number; feeUSD: number; count: number } } = {};
  completed.forEach((t) => {
    const cust = t.customerId as any;
    const cName = cust?.name || 'Walk-in Customer';
    const cPhone = t.customerPhone || cust?.phone || 'N/A';
    if (!customerMap[cName]) {
      customerMap[cName] = { name: cName, phone: cPhone, volumeUSD: 0, feeUSD: 0, count: 0 };
    }
    customerMap[cName].volumeUSD += t.amountReceivedUSD ?? t.amountReceived ?? 0;
    customerMap[cName].feeUSD += t.serviceFeeUSD ?? t.serviceFee ?? 0;
    customerMap[cName].count += 1;
  });
  const topCustomers = Object.values(customerMap).sort((a, b) => b.volumeUSD - a.volumeUSD).slice(0, 10);

  // Wallet Distribution Aggregation
  const walletMap: { [key: string]: { provider: string; volumeUSD: number; feeUSD: number; count: number } } = {};
  completed.forEach((t) => {
    const wp = t.walletProvider;
    if (!walletMap[wp]) {
      walletMap[wp] = { provider: wp, volumeUSD: 0, feeUSD: 0, count: 0 };
    }
    walletMap[wp].volumeUSD += t.amountReceivedUSD ?? t.amountReceived ?? 0;
    walletMap[wp].feeUSD += t.serviceFeeUSD ?? t.serviceFee ?? 0;
    walletMap[wp].count += 1;
  });
  const walletDistribution = Object.values(walletMap).sort((a, b) => b.volumeUSD - a.volumeUSD);
  const accountMovements = isExpandedLedgerEnabled() && !walletProvider && !customerId && (!status || status === 'COMPLETED')
    ? await ledgerMovementTotals(matchQuery.createdAt, matchQuery.cashierId) : undefined;

  return ApiResponse.success(res, 'Comprehensive report generated successfully', {
    summary: {
      totalTransactionsCount: completed.length,
      totalVolumeUSD,
      totalServiceFeesUSD,
      totalCashPaidOutUGX,
      totalProfitUSD,
      // Backward compatibility aliases
      totalVolume: totalVolumeUSD,
      totalServiceFees: totalServiceFeesUSD,
      totalCashPaidOut: totalCashPaidOutUGX,
      totalProfit: totalProfitUSD,
    },
    topCashiers,
    topCustomers,
    walletDistribution,
    accountMovements,
    transactions,
  });
});

export const exportTransactionsExcel = asyncHandler(async (req: Request, res: Response) => {
  const { startDate, endDate, cashierId, walletProvider, customerId, status } = req.query;

  const matchQuery: any = {};
  if (status) matchQuery.status = status;
  if (startDate || endDate) {
    matchQuery.createdAt = {};
    if (startDate) matchQuery.createdAt.$gte = new Date(startDate as string);
    if (endDate) {
      const end = new Date(endDate as string);
      end.setHours(23, 59, 59, 999);
      matchQuery.createdAt.$lte = end;
    }
  }
  if (cashierId) matchQuery.cashierId = cashierId;
  if (walletProvider) matchQuery.walletProvider = walletProvider;
  if (customerId) matchQuery.customerId = customerId;

  const transactions = await Transaction.find(matchQuery)
    .populate('customerId', 'name phone')
    .populate('cashierId', 'name')
    .sort({ createdAt: -1 });

  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Transactions Report');

  worksheet.columns = [
    { header: 'Txn Number', key: 'transactionNumber', width: 18 },
    { header: 'Date & Time', key: 'dateTime', width: 22 },
    { header: 'Customer Name', key: 'customerName', width: 22 },
    { header: 'Phone Number', key: 'customerPhone', width: 16 },
    { header: 'Wallet Channel', key: 'walletProvider', width: 18 },
    { header: 'Amount Received (USD)', key: 'amountReceivedUSD', width: 22 },
    { header: 'Service Fee (USD)', key: 'serviceFeeUSD', width: 18 },
    { header: 'Exchange Rate (UGX/USD)', key: 'exchangeRateUGX', width: 24 },
    { header: 'Cash Paid Out (UGX)', key: 'cashPaidUGX', width: 22 },
    { header: 'Service Fee Profit (USD)', key: 'profitUSD', width: 22 },
    { header: 'Reference No.', key: 'referenceNumber', width: 20 },
    { header: 'Cashier', key: 'cashier', width: 18 },
    { header: 'Status', key: 'status', width: 14 },
  ];

  transactions.forEach((t) => {
    worksheet.addRow({
      transactionNumber: t.transactionNumber,
      dateTime: new Date(t.createdAt).toLocaleString(),
      customerName: (t.customerId as any)?.name || 'Walk-in',
      customerPhone: t.customerPhone,
      walletProvider: t.walletProvider,
      amountReceivedUSD: t.amountReceivedUSD ?? t.amountReceived ?? 0,
      serviceFeeUSD: t.serviceFeeUSD ?? t.serviceFee ?? 0,
      exchangeRateUGX: t.exchangeRateUGX,
      cashPaidUGX: t.cashPaidUGX ?? t.cashPaid ?? 0,
      profitUSD: t.profitUSD ?? t.profit ?? 0,
      referenceNumber: t.referenceNumber || 'N/A',
      cashier: (t.cashierId as any)?.name || 'System',
      status: t.status,
    });
  });

  // Style Header
  worksheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFF' } };
  worksheet.getRow(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: '0F172A' },
  };

  res.setHeader(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  );
  res.setHeader('Content-Disposition', 'attachment; filename=Transactions_Report.xlsx');

  await workbook.xlsx.write(res);
  res.end();
});

export const exportTransactionsCSV = asyncHandler(async (req: Request, res: Response) => {
  const { startDate, endDate, cashierId, walletProvider, customerId, status } = req.query;

  const matchQuery: any = {};
  if (status) matchQuery.status = status;
  if (startDate || endDate) {
    matchQuery.createdAt = {};
    if (startDate) matchQuery.createdAt.$gte = new Date(startDate as string);
    if (endDate) {
      const end = new Date(endDate as string);
      end.setHours(23, 59, 59, 999);
      matchQuery.createdAt.$lte = end;
    }
  }
  if (cashierId) matchQuery.cashierId = cashierId;
  if (walletProvider) matchQuery.walletProvider = walletProvider;
  if (customerId) matchQuery.customerId = customerId;

  const transactions = await Transaction.find(matchQuery)
    .populate('customerId', 'name phone')
    .populate('cashierId', 'name')
    .sort({ createdAt: -1 });

  let csvContent = 'Txn Number,Date Time,Customer,Phone,Wallet,Amount Received (USD),Service Fee (USD),Exchange Rate (UGX/USD),Cash Paid Out (UGX),Service Fee Profit (USD),Reference,Cashier,Status\n';
  const textCell = (value: unknown) => {
    const text = String(value ?? '');
    return `"${(/^[\s]*[=+@-]|^[\t\r\n]/.test(text) ? "'" + text : text).replace(/"/g, '""')}"`;
  };

  transactions.forEach((t) => {
    const custName = textCell((t.customerId as any)?.name || 'Walk-in');
    const cashierName = textCell((t.cashierId as any)?.name || 'System');
    const recUSD = t.amountReceivedUSD ?? t.amountReceived ?? 0;
    const feeUSD = t.serviceFeeUSD ?? t.serviceFee ?? 0;
    const rateUGX = t.exchangeRateUGX ?? '';
    const paidUGX = t.cashPaidUGX ?? t.cashPaid ?? 0;
    const profUSD = t.profitUSD ?? t.profit ?? 0;
    csvContent += `${textCell(t.transactionNumber)},${textCell(new Date(t.createdAt).toLocaleString())},${custName},${textCell(t.customerPhone)},${textCell(t.walletProvider)},${recUSD},${feeUSD},${rateUGX},${paidUGX},${profUSD},${textCell(t.referenceNumber)},${cashierName},${textCell(t.status)}\n`;
  });

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename=Transactions_Report.csv');
  return res.status(200).send(csvContent);
});
