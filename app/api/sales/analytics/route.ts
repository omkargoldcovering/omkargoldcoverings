import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import prisma from '@/lib/prisma';
import {
  startOfDay,
  endOfDay,
  startOfWeek,
  endOfWeek,
  startOfMonth,
  endOfMonth,
  startOfYear,
  endOfYear,
  subDays,
  subMonths,
  subYears,
  addMonths,
  eachDayOfInterval,
  eachWeekOfInterval,
  eachMonthOfInterval,
  format,
  isSameDay,
  isSameWeek,
  isSameMonth
} from 'date-fns';

// Helper function to get date range based on timeframe
function getDateRange(timeframe: string) {
  const now = new Date();
  switch (timeframe) {
    case 'Today':
      return { 
        start: startOfDay(now), 
        end: endOfDay(now),
        previous: { 
          start: startOfDay(subDays(now, 1)), 
          end: endOfDay(subDays(now, 1)) 
        }
      };
    case 'Week':
      return { 
        start: startOfWeek(now), 
        end: endOfWeek(now),
        previous: { 
          start: startOfWeek(subDays(now, 7)), 
          end: endOfWeek(subDays(now, 7)) 
        }
      };
    case 'Month':
    return {
      start: startOfMonth(subMonths(now, 11)), // Start from 11 months ago
      end: endOfMonth(now), // Until current month
      previous: {
        start: startOfMonth(subMonths(now, 23)), // Previous year
        end: endOfMonth(subMonths(now, 12))
      }
    };
    case 'Year':
    return {
      start: startOfYear(subYears(now, 2)), // Start from 2 years ago
      end: endOfYear(now), // Until current year
      previous: {
        start: startOfYear(subYears(now, 3)), // Previous 3 years
        end: endOfYear(subYears(now, 1))
      }
    };
    default:
      return { 
        start: startOfDay(now), 
        end: endOfDay(now),
        previous: { 
          start: startOfDay(subDays(now, 1)), 
          end: endOfDay(subDays(now, 1)) 
        }
      };
  }
}

// Helper function to generate trend data points based on timeframe
function generateTrendDataPoints(timeframe: string | null, dateRange: any) {
  const { start, end } = dateRange;
  const now = new Date();
  let dataPoints = [];
  
  // If no timeframe is provided (custom date range), determine appropriate interval
  if (!timeframe) {
    const daysDiff = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
    
    if (daysDiff <= 1) {
      // For single day, show hourly
      dataPoints = Array.from({ length: 24 }, (_, i) => {
        const date = new Date(start);
        date.setHours(i, 0, 0, 0);
        return {
          name: `${i}:00`,
          timestamp: date.getTime(),
          value: 0 // Initialize with 0
        };
      });
    } else if (daysDiff <= 31) {
      // For up to a month, show daily
      dataPoints = eachDayOfInterval({ start, end }).map(date => ({
        name: format(date, 'MMM dd'),
        timestamp: date.getTime(),
        value: 0 // Initialize with 0
      }));
    } else {
      // For longer periods, show monthly
      dataPoints = eachMonthOfInterval({ start, end }).map(date => ({
        name: format(date, 'MMM yyyy'),
        timestamp: date.getTime(),
        value: 0 // Initialize with 0
      }));
    }
    return dataPoints;
  }
  
  switch (timeframe) {
    case 'Today':
      // For today, show hourly data points
      return Array.from({ length: 24 }, (_, i) => ({
        name: `${i}:00`,
        timestamp: new Date(start).setHours(i, 0, 0, 0),
        value: 0
      }));
    
    case 'Week':
      // For week, show daily data points
      return eachDayOfInterval({ start, end }).map(date => ({
        name: format(date, 'EEE'),
        timestamp: date.getTime(),
        value: 0
      }));
    
    case 'Month':
      // Show continuous 12 months
      const months = [];
      const monthStart = subMonths(endOfMonth(now), 11); // Start 11 months ago
      
      for (let i = 0; i < 12; i++) {
        const date = addMonths(monthStart, i);
        months.push({
          name: format(date, 'MMM'),  // Shows as Jan, Feb, Mar, etc.
          timestamp: date.getTime(),
          value: 0
        });
      }
      return months;
    
    case 'Year':
      // For year, show yearly data points for 2024, 2025, 2026
      const years = [];
      for (let i = 0; i < 3; i++) {
        const year = new Date(start).getFullYear() + i;
        if (year <= new Date(end).getFullYear()) {
          years.push({
            name: year.toString(),
            timestamp: new Date(year, 0, 1).getTime(),
            value: 0
          });
        }
      }
      return years;
    
    default:
      return [];
  }
}

export async function GET(req: NextRequest) {
  try {
    const { userId } = auth();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const timeframe = searchParams.get('timeframe');
    const startDate = searchParams.get('start');
    const endDate = searchParams.get('end');

    let dateRange;
    if (startDate && endDate) {
      dateRange = {
        start: new Date(startDate),
        end: new Date(endDate),
        previous: {
          // Calculate previous period of same length
          start: new Date(new Date(startDate).getTime() - (new Date(endDate).getTime() - new Date(startDate).getTime())),
          end: new Date(startDate)
        }
      };
    } else {
      dateRange = getDateRange(timeframe || 'Today');
    }

    // Get transactions within the date range
    const transactions = await prisma.transaction.findMany({
      where: {
        createdAt: {
          gte: dateRange.start,
          lte: dateRange.end,
        },
      }
    });

    // Fetch previous period transactions for calculating period-over-period changes
    const previousTransactions = await prisma.transaction.findMany({
      where: {
        createdAt: {
          gte: dateRange.previous.start,
          lte: dateRange.previous.end,
        },
      },
    });
// Calculate current period key performance metrics
    // Calculate metrics
    const totalRevenue = transactions.reduce((sum, trans) => sum + trans.totalAmount, 0);
    const totalOrders = transactions.length;
    const avgOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;

    // Calculate previous period metrics for comparison
    const previousRevenue = previousTransactions.reduce((sum, trans) => sum + trans.totalAmount, 0);
    const previousOrders = previousTransactions.length;
    const previousAvgValue = previousOrders > 0 ? previousRevenue / previousOrders : 0;

    // Calculate period-over-period changes as percentages
    // This shows the relative growth or decline in key metrics
    const revenueChange = previousRevenue > 0 
      ? ((totalRevenue - previousRevenue) / previousRevenue) * 100 
      : 0;
    const ordersChange = previousOrders > 0 
      ? ((totalOrders - previousOrders) / previousOrders) * 100 
      : 0;
    const avgValueChange = previousAvgValue > 0 
      ? ((avgOrderValue - previousAvgValue) / previousAvgValue) * 100 
      : 0;

    // Initialize trend points with zero values
    const trendPoints = generateTrendDataPoints(timeframe, dateRange);
    
    // Fill in actual values from transactions
    transactions.forEach(transaction => {
      const transDate = new Date(transaction.createdAt);
      
      for (let i = 0; i < trendPoints.length; i++) {
        const point = trendPoints[i];
        const pointDate = new Date(point.timestamp);
        
        // Match based on timeframe or custom range interval
        let isMatch;
        if (!timeframe) {
          // For custom date range
          const daysDiff = Math.ceil((dateRange.end.getTime() - dateRange.start.getTime()) / (1000 * 60 * 60 * 24));
          if (daysDiff <= 1) {
            isMatch = transDate.getHours() === pointDate.getHours() &&
                     isSameDay(transDate, pointDate);
          } else if (daysDiff <= 31) {
            isMatch = isSameDay(transDate, pointDate);
          } else {
            isMatch = isSameMonth(transDate, pointDate);
          }
        } else {
          isMatch = timeframe === 'Today'
            ? transDate.getHours() === pointDate.getHours()
            : timeframe === 'Week'
            ? isSameDay(transDate, pointDate)
            : timeframe === 'Month'
            ? isSameMonth(transDate, pointDate)
            : transDate.getFullYear() === pointDate.getFullYear();
        }
        
        if (isMatch) {
          if (!point.value) point.value = 0;
          point.value += transaction.totalAmount;
        }
      }
    });

    const salesTrend = trendPoints.map(point => ({
      name: point.name,
      value: point.value || 0
    }));

    // Calculate top selling products by aggregating sales data
    // This helps identify best performing products
    const productSales = new Map();
    transactions.forEach(transaction => {
      const items = transaction.items as any[];
      items.forEach(item => {
        const currentSales = productSales.get(item.productId) || {
          name: item.productName,
          quantity: 0,
          revenue: 0,
        };
        productSales.set(item.productId, {
          name: item.productName,
          quantity: currentSales.quantity + item.quantity,
          revenue: currentSales.revenue + item.total,
        });
      });
    });

    const topProducts = Array.from(productSales.entries())
      .map(([id, data]) => ({
        id,
        name: data.name,
        revenue: data.revenue,
        quantity: data.quantity,
      }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 5);

    // Calculate revenue distribution across product categories
    // This provides insights into which categories drive the most revenue
    const categoryRevenue = new Map();
    transactions.forEach(transaction => {
      const items = transaction.items as any[];
      items.forEach(item => {
        // Note: Category info needs to be included in transaction items during creation
        const category = item.category || 'Uncategorized';
        const currentRevenue = categoryRevenue.get(category) || 0;
        categoryRevenue.set(
          category,
          currentRevenue + item.total
        );
      });
    });

    const revenueByCategory = Array.from(categoryRevenue.entries())
      .map(([category, revenue]) => ({
        category,
        revenue,
        percentage: (revenue / totalRevenue) * 100,
      }));

    return NextResponse.json({
      metrics: {
        totalRevenue,
        totalOrders,
        avgOrderValue,
        previousPeriodComparison: {
          revenue: revenueChange,
          sales: ordersChange,
          avgOrder: avgValueChange,
          orders: ordersChange,
        },
      },
      salesTrend,
      topProducts,
      revenueByCategory,
    });
  } catch (error) {
    console.error('Error fetching sales analytics:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}